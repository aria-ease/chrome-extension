import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { test, after } from "node:test";
import { runtimePaths } from "../paths.mjs";

const run = promisify(execFile);
const cli = path.resolve(import.meta.dirname, "..", "aria-ease-component-audit.mjs");
const root = runtimePaths.projectRoot;
const harnessUrl = "http://127.0.0.1:5173/test-harness?component=combobox";

async function runCli(args) {
  try {
    const result = await run(process.execPath, [cli, ...args], { maxBuffer: 1024 * 1024 });
    return { ...result, code: 0 };
  } catch (error) {
    return { stdout: error.stdout ?? "", stderr: error.stderr ?? "", code: error.code ?? 1 };
  }
}

const temporaryDirectories = [];

after(async () => {
  await Promise.all(temporaryDirectories.map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

test("runs the existing combobox contract through the harness", async () => {
  const report = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "aria-ease-cli-")), "report.json");
  temporaryDirectories.push(path.dirname(report));
  const result = await runCli([
    "--url", harnessUrl,
    "--component", "combobox",
    "--root", root,
    "--report", report
  ]);

  assert.equal(result.code, 0, result.stderr);
  const parsed = JSON.parse(await fs.readFile(report, "utf8"));
  assert.equal(parsed.status, "passed");
  assert.equal(parsed.failures.length, 0);
});

test("rejects an invalid component name", async () => {
  const result = await runCli([
    "--url", harnessUrl,
    "--component", "does-not-exist",
    "--root", root
  ]);

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /No contract configuration found for component/);
});

test("reports contract failures as failures", async () => {
  const report = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "aria-ease-cli-failure-")), "report.json");
  temporaryDirectories.push(path.dirname(report));
  const result = await runCli([
    "--url", "data:text/html,<div role=\"combobox\"></div>",
    "--component", "combobox",
    "--root", root,
    "--report", report
  ]);

  assert.notEqual(result.code, 0);
  const parsed = JSON.parse(await fs.readFile(report, "utf8"));
  assert.equal(parsed.status, "failed");
  assert.ok(parsed.failures.length > 0);
});

test("reports a missing target as an execution error", async () => {
  const result = await runCli([
    "--url", "data:text/html,<main></main>",
    "--component", "combobox",
    "--root", root,
    "--component-ready-timeout", "25"
  ]);

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Component not found on page|Execution error/);
});
