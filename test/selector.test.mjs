import assert from "node:assert/strict";
import { after, before, test } from "node:test";

before(async () => {
  delete globalThis.ariaEaseSelector;
  await import(`../chrome-mvp/selector.js?test=${Date.now()}`);
});

after(() => {
  delete globalThis.ariaEaseSelector;
});

function element({ id = "", role = null, attributes = [] } = {}) {
  const values = new Map(attributes.map(({ name, value }) => [name, value]));
  if (role !== null) values.set("role", role);
  if (id) values.set("id", id);
  return {
    nodeType: 1,
    id,
    localName: "input",
    classList: [],
    attributes: [...values].map(([name, value]) => ({ name, value })),
    ownerDocument: null,
    parentElement: null,
    getAttribute(name) { return values.get(name) ?? null; }
  };
}

test("generates a unique ID selector for a combobox", () => {
  const combobox = element({ id: "search", role: "combobox" });
  combobox.ownerDocument = {
    documentElement: {},
    querySelectorAll(selector) { return selector === "#search" ? [combobox] : []; }
  };
  assert.equal(globalThis.ariaEaseSelector.uniqueSelector(combobox), "#search");
});

test("rejects non-combobox elements", () => {
  const input = element({ id: "search" });
  assert.throws(() => globalThis.ariaEaseSelector.uniqueSelector(input), /role="combobox"/);
});

test("generates selectors for non-combobox discovery targets", () => {
  const tablist = element({ id: "account-tabs", role: "tablist" });
  tablist.ownerDocument = {
    documentElement: {},
    querySelectorAll(selector) { return selector === "#account-tabs" ? [tablist] : []; }
  };
  assert.equal(globalThis.ariaEaseSelector.uniqueElementSelector(tablist), "#account-tabs");
});

test("extracts selector and accessible metadata", () => {
  const combobox = element({
    id: "search",
    role: "combobox",
    attributes: [
      { name: "aria-label", value: "Search" },
      { name: "aria-expanded", value: "false" }
    ]
  });
  assert.deepEqual(globalThis.ariaEaseSelector.selectedMetadata(combobox, "#search"), {
    selector: "#search",
    tag: "input",
    id: "search",
    role: "combobox",
    accessibleNameAttributes: { ariaLabel: "Search", ariaLabelledby: null, title: null },
    aria: { "aria-label": "Search", "aria-expanded": "false", role: "combobox", id: "search" }
  });
});
