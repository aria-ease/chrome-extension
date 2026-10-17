import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createSelectionContext,
  DEFAULT_SELECTION_MAX_AGE_MS,
  validateSelectionContext
} from "../chrome-mvp/selection-context.mjs";

const tab = { id: 42, url: "https://example.test/search" };

test("binds a component selection to its tab, URL, and selection time", () => {
  assert.deepEqual(createSelectionContext({ selector: "#search", role: "combobox" }, tab, 1000), {
    selector: "#search",
    role: "combobox",
    tabId: 42,
    pageUrl: tab.url,
    selectedAt: 1000
  });
});

test("accepts a current selection in its original page", () => {
  const selection = createSelectionContext({ selector: "#search" }, tab, 1000);
  assert.equal(validateSelectionContext(selection, tab, { now: 2000 }), selection);
});

test("rejects selections from another tab or URL", () => {
  const selection = createSelectionContext({ selector: "#search" }, tab, 1000);
  assert.throws(() => validateSelectionContext(selection, { ...tab, id: 43 }, { now: 2000 }), /active tab/i);
  assert.throws(() => validateSelectionContext(selection, { ...tab, url: "https://example.test/other" }, { now: 2000 }), /page has changed/i);
});

test("rejects expired and legacy selections", () => {
  const selection = createSelectionContext({ selector: "#search" }, tab, 1000);
  assert.throws(
    () => validateSelectionContext(selection, tab, { now: 1001 + DEFAULT_SELECTION_MAX_AGE_MS }),
    /expired/i
  );
  assert.throws(() => validateSelectionContext({ selector: "#search" }, tab), /no page context/i);
});
