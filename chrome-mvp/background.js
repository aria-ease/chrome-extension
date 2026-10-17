import { createSelectionContext } from "./selection-context.mjs";

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    serviceUrl: "http://127.0.0.1:4317",
    root: ""
  });
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!sender.tab?.id) return;
  if (message.type === "aria-ease-selection") {
    const selection = createSelectionContext(message.selection, sender.tab);
    chrome.storage.local.set({ latestSelection: selection, latestSelectionError: "", selectionCancelled: false });
  } else if (message.type === "aria-ease-selection-error") {
    chrome.storage.local.set({ latestSelectionError: message.message, selectionCancelled: false });
  } else if (message.type === "aria-ease-selection-cancelled") {
    chrome.storage.local.set({ selectionCancelled: true, latestSelectionError: "" });
  } else if (message.type === "aria-ease-selection-ready") {
    chrome.storage.local.set({ selectionCancelled: false, latestSelectionError: "" });
  } else if (message.type === "aria-ease-discovery") {
    const discovery = createSelectionContext(message.discovery, sender.tab);
    chrome.storage.local.set({ latestDiscovery: discovery, latestDiscoveryError: "" });
  } else if (message.type === "aria-ease-discovery-error") {
    chrome.storage.local.set({ latestDiscovery: null, latestDiscoveryError: message.message });
  }
});

async function clearPageStateForTab(tabId) {
  const { latestSelection, latestDiscovery } = await chrome.storage.local.get({ latestSelection: null, latestDiscovery: null });
  const updates = {};
  if (latestSelection?.tabId === tabId) Object.assign(updates, { latestSelection: null, latestSelectionError: "", selectionCancelled: false });
  if (latestDiscovery?.tabId === tabId) Object.assign(updates, { latestDiscovery: null, latestDiscoveryError: "" });
  if (Object.keys(updates).length) await chrome.storage.local.set(updates);
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading" || changeInfo.url) clearPageStateForTab(tabId).catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  clearPageStateForTab(tabId).catch(() => {});
});
