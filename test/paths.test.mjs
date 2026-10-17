import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { resolveRuntimePaths } from "../paths.mjs";

test("uses sibling repositories by default", () => {
  const baseDir = path.resolve("workspace", "chrome-extension");
  const paths = resolveRuntimePaths({ environment: {}, baseDir });
  assert.equal(paths.ariaEaseRoot, path.resolve(baseDir, "../aria-ease"));
  assert.equal(paths.projectRoot, path.resolve(baseDir, "../frontend-testing-ground"));
  assert.deepEqual(paths.approvedRoots, [paths.projectRoot]);
});

test("supports absolute and relative repository overrides", () => {
  const baseDir = path.resolve("workspace", "chrome-extension");
  const paths = resolveRuntimePaths({
    baseDir,
    environment: {
      ARIA_EASE_PACKAGE_ROOT: "../library",
      ARIA_EASE_PROJECT_ROOT: "../application",
      ARIA_EASE_APPROVED_ROOTS: ["../application", "../fixtures"].join(path.delimiter)
    }
  });
  assert.equal(paths.ariaEaseRoot, path.resolve(baseDir, "../library"));
  assert.equal(paths.projectRoot, path.resolve(baseDir, "../application"));
  assert.deepEqual(paths.approvedRoots, [
    path.resolve(baseDir, "../application"),
    path.resolve(baseDir, "../fixtures")
  ]);
});
