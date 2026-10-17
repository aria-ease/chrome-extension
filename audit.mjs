import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runtimePaths } from "./paths.mjs";

const packageRoot = runtimePaths.ariaEaseRoot;

async function importAriaEaseBuild(relativePath) {
  const modulePath = path.join(packageRoot, relativePath);
  try {
    return await import(pathToFileURL(modulePath));
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") {
      throw new Error(
        `Aria-Ease build output was not found at ${modulePath}. ` +
        "Build the sibling aria-ease repository with `npm run build` before starting the audit service.",
        { cause: error }
      );
    }
    throw error;
  }
}

const testApi = await importAriaEaseBuild("dist/src/utils/test/index.js");
const dslApi = await importAriaEaseBuild("dist/src/utils/test/dsl/index.js");

export const strictnessValues = new Set(["minimal", "balanced", "strict", "paranoid"]);
export const timeoutFields = ["actionTimeoutMs", "assertionTimeoutMs", "navigationTimeoutMs", "componentReadyTimeoutMs"];
export const timeoutOptions = {
  actionTimeoutMs: "action-timeout",
  assertionTimeoutMs: "assertion-timeout",
  navigationTimeoutMs: "navigation-timeout",
  componentReadyTimeoutMs: "component-ready-timeout"
};

function timeoutValue(value, option) {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${option} must be a non-negative number`);
  }
  return parsed;
}

async function writeReport(reportPath, report) {
  await fs.mkdir(path.dirname(path.resolve(reportPath)), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

/**
 * Compile and execute one configured Aria-Ease component contract.
 */
export async function runAudit(request) {
  if (!request || typeof request !== "object") throw new Error("Audit request must be an object");
  const { url, component, root } = request;
  if (typeof url !== "string" || url.length === 0) throw new Error("url must be a non-empty string");
  if (typeof component !== "string" || component.length === 0) throw new Error("component must be a non-empty string");
  if (typeof root !== "string" || root.length === 0) throw new Error("root must be a non-empty string");
  if (request.targetSelector !== undefined) {
    if (typeof request.targetSelector !== "string" || request.targetSelector.length === 0 || request.targetSelector.length > 500) {
      throw new Error("targetSelector must be a non-empty CSS selector of at most 500 characters");
    }
    if (/[\0\r\n]/.test(request.targetSelector) || /^(javascript|xpath):|^(xpath|text|id|role|nth|visible)=/i.test(request.targetSelector) || request.targetSelector.includes(">>")) {
      throw new Error("targetSelector must be a CSS selector");
    }
  }
  if (request.scenario !== undefined) {
    throw new Error("scenario selection is not supported by the existing contract runner");
  }
  if (request.strictness !== undefined && !strictnessValues.has(request.strictness)) {
    throw new Error(`invalid strictness: ${request.strictness}`);
  }

  const loaded = await testApi.loadConfig(path.resolve(root));
  if (loaded.errors.length > 0) throw new Error(loaded.errors.join("\n"));
  const config = loaded.config;
  const componentConfig = config.test?.components?.find(({ name }) => name === component);
  if (!componentConfig) {
    throw new Error(`No contract configuration found for component: ${component}`);
  }

  const build = await dslApi.buildContracts(path.resolve(root), config);
  if (!build.success) throw new Error(`Contract compilation failed:\n${build.errors.join("\n")}`);

  const testConfig = { ...(config.test ?? {}) };
  const selectedComponent = { ...componentConfig };
  if (request.strictness) selectedComponent.strictness = request.strictness;
  if (request.disableTimeouts !== undefined) {
    if (typeof request.disableTimeouts !== "boolean") throw new Error("disableTimeouts must be a boolean");
    selectedComponent.disableTimeouts = request.disableTimeouts;
  }
  for (const field of timeoutFields) {
    const option = timeoutOptions[field];
    const value = request[field] ?? request[option];
    const parsed = timeoutValue(value, option);
    if (parsed !== undefined) selectedComponent[field] = parsed;
  }
  testConfig.components = [
    ...(testConfig.components ?? []).filter(({ name }) => name !== component),
    selectedComponent
  ];

  try {
    const result = await testApi.runContractTestsPlaywright(
      component,
      url,
      request.strictness ?? componentConfig.strictness ?? config.test?.strictness,
      { ...config, test: testConfig },
      loaded.configPath ? path.dirname(loaded.configPath) : path.resolve(root),
      { targetSelector: request.targetSelector }
    );
    const report = {
      component,
      url,
      status: result.failures.length > 0 ? "failed" : result.skipped.length > 0 ? "skipped" : "passed",
      ...result
    };
    if (request.report?.path) await writeReport(request.report.path, report);
    return report;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failure = `Execution error: ${message}`;
    const report = {
      component,
      url,
      status: "failed",
      passes: [],
      failures: [failure],
      skipped: [],
      warnings: [],
      findings: [
        {
          id: `${component}:static:execution`,
          status: "fail",
          level: "required",
          phase: "static",
          rule: "contract-runner",
          message: failure
        },
        {
          id: `${component}:dynamic:execution`,
          status: "fail",
          level: "required",
          phase: "dynamic",
          rule: "contract-runner",
          scenario: "Contract runner execution",
          message: failure
        }
      ]
    };
    if (request.report?.path) await writeReport(request.report.path, report);
    return report;
  } finally {
    await testApi.closeSharedBrowser();
  }
}
