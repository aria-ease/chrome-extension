import assert from "node:assert/strict";
import { after, before, test } from "node:test";

before(async () => {
  delete globalThis.ariaEaseComponentStrategies;
  await import(`../chrome-mvp/component-strategies.js?test=${Date.now()}`);
});

after(() => {
  delete globalThis.ariaEaseComponentStrategies;
});

test("registers every Aria-Ease component type", () => {
  assert.deepEqual(
    globalThis.ariaEaseComponentStrategies.list().map(({ type }) => type),
    ["combobox", "radio", "tabs", "checkbox", "menu", "accordion", "toggle", "block"]
  );
});

test("limits automatic discovery to component types with unambiguous semantic roots", () => {
  assert.deepEqual(
    globalThis.ariaEaseComponentStrategies.list({ automaticOnly: true }).map(({ type }) => type),
    ["combobox", "radio", "tabs", "checkbox", "menu"]
  );
});

test("resolves a selected descendant through its component strategy", () => {
  const root = { id: "tabs" };
  const child = {
    closest(selector) {
      assert.equal(selector, '[role="tablist"]');
      return root;
    }
  };
  assert.equal(globalThis.ariaEaseComponentStrategies.resolveTarget(child, "tabs"), root);
  assert.throws(() => globalThis.ariaEaseComponentStrategies.resolveTarget(child, "unknown"), /Unsupported/);
});

test("discovers and labels automatic component roots", () => {
  const combobox = { id: "search" };
  const tabs = { id: "settings" };
  const matches = new Map([
    ['[role="combobox"]', [combobox]],
    ['[role="tablist"]', [tabs]]
  ]);
  const found = globalThis.ariaEaseComponentStrategies.discover({
    querySelectorAll(selector) { return matches.get(selector) || []; }
  });
  assert.deepEqual(found, [
    { component: "combobox", label: "Combobox", element: combobox },
    { component: "tabs", label: "Tabs", element: tabs }
  ]);
});
