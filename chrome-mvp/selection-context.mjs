export const DEFAULT_SELECTION_MAX_AGE_MS = 30 * 60 * 1000;

export function createSelectionContext(selection, tab, selectedAt = Date.now()) {
  if (!selection || typeof selection !== "object") throw new Error("Selection details are missing.");
  if (!Number.isInteger(tab?.id) || typeof tab?.url !== "string" || !tab.url) {
    throw new Error("The selected tab context is unavailable.");
  }
  return { ...selection, tabId: tab.id, pageUrl: tab.url, selectedAt };
}

export function validateSelectionContext(selection, tab, {
  now = Date.now(),
  maxAgeMs = DEFAULT_SELECTION_MAX_AGE_MS
} = {}) {
  if (!selection || !Number.isInteger(selection.tabId) || typeof selection.pageUrl !== "string") {
    throw new Error("The saved selection has no page context. Select the component again.");
  }
  if (!Number.isInteger(tab?.id) || selection.tabId !== tab.id) {
    throw new Error("The active tab is not the tab where this component was selected. Select it again.");
  }
  if (typeof tab.url !== "string" || selection.pageUrl !== tab.url) {
    throw new Error("The selected page has changed. Select the component again.");
  }
  if (!Number.isFinite(selection.selectedAt) || now - selection.selectedAt > maxAgeMs || selection.selectedAt > now) {
    throw new Error("The saved component selection has expired. Select it again.");
  }
  return selection;
}
