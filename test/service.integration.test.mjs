import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import path from "node:path";
import { createAuditService } from "../service.mjs";
import { runtimePaths } from "../paths.mjs";

const root = runtimePaths.projectRoot;
const harnessUrl = "http://127.0.0.1:5173/test-harness?component=combobox";
let service;
let baseUrl;

before(async () => {
  service = createAuditService({ port: 0 });
  const address = await service.listen();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await service.close();
});

async function audit(body, token = service.token) {
  return fetch(`${baseUrl}/api/audits`, {
    method: "POST",
    headers: {
      authorization: token === null ? "" : `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

const validRequest = () => ({ url: harnessUrl, component: "combobox", root });

test("health endpoint does not expose the token", async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("accepts the exact service token and rejects missing and stale tokens", async () => {
  const runner = async () => ({ status: "passed", passes: [], failures: [], skipped: [], warnings: [] });
  const authService = createAuditService({ port: 0, token: "current-token", auditRunner: runner });
  const address = await authService.listen();
  const url = `http://127.0.0.1:${address.port}/api/audits`;
  const body = JSON.stringify(validRequest());
  const request = (token) => fetch(url, {
    method: "POST",
    headers: {
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      "content-type": "application/json"
    },
    body
  });
  assert.equal((await request("current-token")).status, 200);
  assert.equal((await request(undefined)).status, 401);
  assert.equal((await request("old-token")).status, 401);
  await authService.close();
});

test("allows only the configured extension origin for CORS", async () => {
  const extensionService = createAuditService({ port: 0, extensionOrigins: ["chrome-extension://test-extension"] });
  const address = await extensionService.listen();
  const url = `http://127.0.0.1:${address.port}/api/audits`;
  const allowed = await fetch(url, {
    method: "OPTIONS",
    headers: {
      origin: "chrome-extension://test-extension",
      "access-control-request-method": "POST"
    }
  });
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get("access-control-allow-origin"), "chrome-extension://test-extension");
  const rejected = await fetch(url, {
    method: "OPTIONS",
    headers: {
      origin: "chrome-extension://another-extension",
      "access-control-request-method": "POST"
    }
  });
  assert.equal(rejected.status, 403);
  await extensionService.close();
});

test("runs an authenticated combobox audit", async () => {
  const response = await audit(validRequest());
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.status, "passed");
});

test("runs a targeted combobox audit", async () => {
  const response = await audit({ ...validRequest(), targetSelector: "#fruit" });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.status, "passed");
});

test("rejects unsafe target-selector input", async () => {
  const response = await audit({ ...validRequest(), targetSelector: "javascript:alert(1)" });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /CSS selector/);
});

test("rejects malformed JSON", async () => {
  const response = await fetch(`${baseUrl}/api/audits`, {
    method: "POST",
    headers: { authorization: `Bearer ${service.token}`, "content-type": "application/json" },
    body: "{"
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /valid JSON/);
});

test("rejects invalid components and missing authentication", async () => {
  const invalid = await audit({ ...validRequest(), component: "unknown-component" });
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /No contract configuration/);

  const missing = await audit(validRequest(), null);
  assert.equal(missing.status, 401);
});

test("returns contract failures as structured unsuccessful results", async () => {
  const response = await audit({
    url: "data:text/html,<div role=\"combobox\"></div>",
    component: "combobox",
    root
  });
  const body = await response.json();
  assert.equal(response.status, 422);
  assert.equal(body.status, "failed");
  assert.ok(body.failures.length > 0);
  assert.ok(Array.isArray(body.findings));
  assert.ok(body.findings.some((finding) => finding.status === "fail" && finding.scenario));
});

test("returns complete structured findings alongside complete legacy arrays", async () => {
  const response = await audit({
    url: "data:text/html,<div role=\"combobox\"></div>",
    component: "combobox",
    root
  });
  const body = await response.json();
  assert.equal(response.status, 422);
  assert.ok(Array.isArray(body.findings));
  assert.ok(body.findings.length > 0);
  assert.ok(Array.isArray(body.passes));
  assert.ok(Array.isArray(body.failures));
  assert.ok(Array.isArray(body.warnings));
  assert.ok(Array.isArray(body.skipped));

  for (const finding of body.findings) {
    assert.ok(finding.id);
    assert.ok(["fail", "warn", "skip"].includes(finding.status));
    assert.ok(finding.message);
  }
  assert.ok(body.findings.some((finding) => finding.phase === "dynamic" && finding.scenario));
  assert.ok(body.findings.some((finding) => finding.phase === "static"));
});

test("rejects concurrent audits and cleans up after the first completes", async () => {
  const first = audit(validRequest());
  const second = audit(validRequest());
  const responses = await Promise.all([first, second]);
  const statuses = responses.map((response) => response.status).sort();
  assert.deepEqual(statuses, [200, 409]);

  const afterConcurrency = await audit(validRequest());
  assert.equal(afterConcurrency.status, 200);
});
