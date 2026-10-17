#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { runAudit, strictnessValues, timeoutFields, timeoutOptions } from "./audit.mjs";
import { runtimePaths } from "./paths.mjs";

function usage(message) {
  if (message) console.error(`Error: ${message}\n`);
  console.error("Usage: npm run audit -- --url <url> --component <name> [options]");
  console.error("Options:");
  console.error("  --root <path>                 Project root containing ariaease.config.*");
  console.error("  --strictness <level>          minimal | balanced | strict | paranoid");
  console.error("  --action-timeout <ms>");
  console.error("  --assertion-timeout <ms>");
  console.error("  --navigation-timeout <ms>");
  console.error("  --component-ready-timeout <ms>");
  console.error("  --target-selector <css>       Audit exactly one combobox instance");
  console.error("  --disable-timeouts");
  console.error("  --report <path>               Write the machine-readable result to a JSON file");
  console.error("  --scenario <name>             Not supported by the current runner API");
  process.exitCode = 2;
}

function parseArgs(argv) {
  const options = { root: runtimePaths.projectRoot };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      usage();
      process.exitCode = 0;
      return null;
    }
    if (argument === "--disable-timeouts") {
      options.disableTimeouts = true;
      continue;
    }
    if (!argument.startsWith("--")) {
      throw new Error(`Unexpected argument: ${argument}`);
    }
    const name = argument.slice(2);
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${name}`);
    options[name] = value;
  }
  return options;
}

function numberOption(options, name, field) {
  if (options[name] === undefined) return undefined;
  const value = Number(options[name]);
  if (!Number.isFinite(value) || value < 0) throw new Error(`--${name} must be a non-negative number`);
  return [field, value];
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options) return;
  if (!options.url || !options.component) {
    usage("--url and --component are required");
    return;
  }
  if (options.scenario) {
    usage("scenario selection is not supported by the existing contract runner");
    return;
  }
  if (options.strictness && !strictnessValues.has(options.strictness)) {
    usage(`invalid strictness: ${options.strictness}`);
    return;
  }

  const request = {
    url: options.url,
    component: options.component,
    root: path.resolve(options.root),
    strictness: options.strictness,
    targetSelector: options.targetSelector,
    disableTimeouts: options.disableTimeouts,
    report: options.report ? { path: options.report } : undefined
  };
  for (const field of timeoutFields) {
    const option = numberOption(options, timeoutOptions[field], field);
    if (option) request[option[0]] = option[1];
  }

  console.log(`Running ${options.component} contract against ${options.url}`);
  const result = await runAudit(request);

  console.log(`Passed: ${result.passes.length}`);
  console.log(`Failed: ${result.failures.length}`);
  console.log(`Skipped: ${result.skipped.length}`);
  if (result.warnings?.length) console.log(`Warnings: ${result.warnings.length}`);
  if (result.failures.length > 0) {
    result.failures.forEach((failure) => console.error(`FAIL: ${failure}`));
    process.exitCode = 1;
  } else if (result.skipped.length > 0) {
    result.skipped.forEach((skip) => console.error(`SKIP: ${skip}`));
    process.exitCode = 1;
  } else {
    console.log("Audit passed.");
  }
}

try {
  await main();
} catch (error) {
  console.error(`Execution error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
