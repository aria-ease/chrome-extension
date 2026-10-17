#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { runAudit } from "./audit.mjs";
import { runtimePaths } from "./paths.mjs";

const localhostOrigin = /^(https?:\/\/)(localhost|127\.0\.0\.1)(:\d+)?$/;

function isApprovedRoot(candidate, approvedRoots) {
  return approvedRoots.some((approvedRoot) => {
    const relative = path.relative(approvedRoot, candidate);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });
}

function sendJson(response, statusCode, body, origin) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...(origin ? {
      "access-control-allow-origin": origin,
      "vary": "Origin"
    } : {})
  });
  response.end(`${JSON.stringify(body)}\n`);
}

function applyCors(response, request, extensionOrigins) {
  const origin = request.headers.origin;
  if (typeof origin === "string" && (localhostOrigin.test(origin) || extensionOrigins.has(origin))) {
    response.setHeader("access-control-allow-origin", origin);
    response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    response.setHeader("access-control-allow-headers", "authorization, content-type");
    response.setHeader("vary", "Origin");
    return origin;
  }
  return undefined;
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error("Request body exceeds the 1 MiB limit");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Request body must contain valid JSON");
  }
}

function validateRequest(body, approvedRoots) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Audit request must be a JSON object");
  }
  const allowedFields = new Set([
    "url", "component", "root", "strictness", "disableTimeouts",
    "actionTimeoutMs", "assertionTimeoutMs", "navigationTimeoutMs",
    "componentReadyTimeoutMs", "targetSelector", "report"
  ]);
  const unsupported = Object.keys(body).filter((key) => !allowedFields.has(key));
  if (unsupported.length > 0) throw new Error(`Unsupported audit option: ${unsupported[0]}`);
  if (typeof body.url !== "string" || body.url.length === 0) throw new Error("url must be a non-empty string");
  let target;
  try {
    target = new URL(body.url);
  } catch {
    throw new Error("url must be a valid URL");
  }
  if (!["http:", "https:", "data:"].includes(target.protocol)) {
    throw new Error("url must use http, https, or data protocol");
  }
  if (typeof body.component !== "string" || body.component.length === 0) {
    throw new Error("component must be a non-empty string");
  }
  if (body.targetSelector !== undefined) {
    if (typeof body.targetSelector !== "string" || body.targetSelector.length === 0 || body.targetSelector.length > 500) {
      throw new Error("targetSelector must be a non-empty CSS selector of at most 500 characters");
    }
    if (/[\0\r\n]/.test(body.targetSelector) || /^(javascript|xpath):|^(xpath|text|id|role|nth|visible)=/i.test(body.targetSelector) || body.targetSelector.includes(">>")) {
      throw new Error("targetSelector must be a CSS selector");
    }
  }
  if (typeof body.root !== "string" || body.root.length === 0) throw new Error("root must be a non-empty string");
  const root = path.resolve(body.root);
  if (!isApprovedRoot(root, approvedRoots)) throw new Error("root is outside the approved project roots");
  if (body.strictness !== undefined && !["minimal", "balanced", "strict", "paranoid"].includes(body.strictness)) {
    throw new Error("invalid strictness");
  }
  if (body.disableTimeouts !== undefined && typeof body.disableTimeouts !== "boolean") {
    throw new Error("disableTimeouts must be a boolean");
  }
  for (const field of ["actionTimeoutMs", "assertionTimeoutMs", "navigationTimeoutMs", "componentReadyTimeoutMs"]) {
    if (body[field] !== undefined && (!Number.isFinite(body[field]) || body[field] < 0)) {
      throw new Error(`${field} must be a non-negative number`);
    }
  }
  if (body.report !== undefined) {
    if (!body.report || typeof body.report !== "object" || typeof body.report.path !== "string") {
      throw new Error("report must contain a path string");
    }
    const reportPath = path.resolve(body.report.path);
    if (!isApprovedRoot(reportPath, approvedRoots)) throw new Error("report path is outside the approved project roots");
  }
  return { ...body, root };
}

export function createAuditService({
  port = 4317,
  approvedRoots = runtimePaths.approvedRoots,
  auditRunner = runAudit,
  token = process.env.ARIA_EASE_AUTH_TOKEN?.trim() || randomBytes(32).toString("hex"),
  extensionOrigins = (process.env.ARIA_EASE_EXTENSION_ORIGINS || "").split(",").map((origin) => origin.trim()).filter(Boolean)
} = {}) {
  const roots = approvedRoots.map((root) => path.resolve(root));
  const configuredExtensionOrigins = new Set(extensionOrigins);
  let auditInProgress = false;

  const server = http.createServer(async (request, response) => {
    const origin = applyCors(response, request, configuredExtensionOrigins);
    if (process.env.ARIA_EASE_AUTH_DIAGNOSTICS === "1" && request.url === "/api/audits") {
      const authorization = request.headers.authorization;
      const token = typeof authorization === "string" && authorization.startsWith("Bearer ")
        ? authorization.slice("Bearer ".length)
        : "";
      const authenticated = authorization === `Bearer ${token}`;
      console.error(`[auth] request=${request.method} tokenPresent=${token.length > 0} tokenLength=${token.length} authenticated=${authenticated}`);
    }
    try {
      if (request.method === "OPTIONS") {
        if (request.headers.origin && !origin) return sendJson(response, 403, { error: "Origin is not allowed" });
        response.writeHead(204);
        return response.end();
      }
      if (request.method === "GET" && request.url === "/health") {
        return sendJson(response, 200, { status: "ok" }, origin);
      }
      if (request.method !== "POST" || request.url !== "/api/audits") {
        return sendJson(response, 404, { error: "Not found" }, origin);
      }

      const authorization = request.headers.authorization;
      if (authorization !== `Bearer ${token}`) {
        return sendJson(response, 401, { error: "Missing or invalid authentication token" }, origin);
      }
      if (auditInProgress) {
        return sendJson(response, 409, { error: "An audit is already in progress" }, origin);
      }
      auditInProgress = true;
      try {
        const body = await readJson(request);
        const auditRequest = validateRequest(body, roots);
        const result = await auditRunner(auditRequest);
        return sendJson(response, result.status === "passed" ? 200 : 422, result, origin);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return sendJson(response, 400, { error: message }, origin);
      } finally {
        auditInProgress = false;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!response.headersSent) sendJson(response, 500, { error: message }, origin);
    }
  });

  return {
    server,
    token,
    async listen() {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", resolve);
      });
      return server.address();
    },
    async close() {
      if (!server.listening) return;
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const configuredToken = process.env.ARIA_EASE_AUTH_TOKEN?.trim();
  if (configuredToken === "") {
    throw new Error("ARIA_EASE_AUTH_TOKEN must not be empty when provided");
  }
  const service = createAuditService({
    port: Number(process.env.PORT) || 4317,
    ...(configuredToken ? { token: configuredToken } : {})
  });
  const address = await service.listen();
  console.log(`Aria-Ease audit service listening on http://127.0.0.1:${address.port}`);
  console.log(`Authentication token: ${service.token}`);
  const shutdown = async () => {
    await service.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
