import { buildAuditRequest, responseError, validateTargetUrl } from "./request.mjs";
import { summarizeResult, renderFindingsHtml } from "./findings.mjs";
import { createSelectionContext, validateSelectionContext } from "./selection-context.mjs";
import { clearSessionToken, migrateLegacyToken, saveSessionToken } from "./token-storage.mjs";
import { buildExcelReport, reportFilename } from "./excel-report.mjs";

const DEFAULT_SERVICE_URL = "http://127.0.0.1:4317";
const $ = (id) => document.getElementById(id);
let selection = null;
let discovery = null;
let lastAuditReport = null;

function setStatus(message, kind = "") {
  $("status").textContent = message;
  $("status").className = kind;
}

function normalizeServiceUrl(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || !["127.0.0.1", "localhost"].includes(url.hostname)) {
    throw new Error("The service URL must use HTTP(S) on localhost or 127.0.0.1.");
  }
  return url.origin;
}

async function settings() {
  const [values, token] = await Promise.all([
    chrome.storage.local.get({ serviceUrl: DEFAULT_SERVICE_URL, root: "" }),
    migrateLegacyToken()
  ]);
  $("service-url").value = values.serviceUrl;
  $("token").value = token;
  $("root").value = values.root;
}

async function saveSettings() {
  const serviceUrl = normalizeServiceUrl($("service-url").value.trim());
  const token = $("token").value.trim();
  const root = $("root").value.trim();
  if (!token) throw new Error("Enter the bearer token printed by the local service.");
  if (!root) throw new Error("Enter an approved project root.");
  const savedToken = await saveSessionToken(token);
  await chrome.storage.local.set({ serviceUrl, root });
  return { serviceUrl, token: savedToken, root };
}

async function clearToken() {
  await clearSessionToken();
  $("token").value = "";
  setStatus("Bearer token cleared for this browser session.");
}

async function activeTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs[0]?.id || !tabs[0].url) throw new Error("No inspectable active tab is available.");
  $("page-url").value = tabs[0].url;
  validateTargetUrl(tabs[0].url);
  return tabs[0];
}

async function startSelection() {
  const tab = await activeTab();
  if ($("audit-scope").value === "all") {
    clearDiscovery();
    await chrome.storage.local.set({ latestDiscovery: null, latestDiscoveryError: "" });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["component-strategies.js", "selector.js", "discover-components.js"]
    });
    setStatus("Scanning this page for supported components...");
    return;
  }
  await removeDiscoveryHighlights(tab);
  clearSelection();
  await chrome.storage.local.set({ latestSelection: null, latestSelectionError: "", selectionCancelled: false });
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["component-strategies.js", "selector.js", "content-script.js"]
  });
  setStatus("Hover over a combobox and click it. Press Escape to cancel.");
}

async function removeDiscoveryHighlights(tab = null) {
  const targetTab = tab || await activeTab();
  await chrome.scripting.executeScript({
    target: { tabId: targetTab.id },
    files: ["clear-discovery-highlights.js"]
  });
}

async function clearDiscoveryAndHighlights() {
  await removeDiscoveryHighlights();
  clearDiscovery();
  setStatus("Component highlights cleared.");
}

function showDiscovery(value) {
  discovery = value;
  $("audit-scope").value = "all";
  $("select").textContent = "Scan page";
  const targets = value.targets || [];
  $("discovery-summary").textContent = `${targets.length} supported component${targets.length === 1 ? "" : "s"} found on this page.`;
  $("discovery-list").replaceChildren(...targets.map((target) => {
    const item = document.createElement("li");
    item.textContent = `${target.label}: ${target.selector}`;
    return item;
  }));
  const failures = value.errors || [];
  $("discovery-errors").textContent = failures.length
    ? `${failures.length} component${failures.length === 1 ? " was" : "s were"} omitted because a unique selector could not be generated.`
    : "";
  $("discovery").classList.remove("hidden");
  $("result").classList.add("hidden");
  setStatus("Component scan complete.", "success");
}

function clearDiscovery() {
  discovery = null;
  chrome.storage.local.set({ latestDiscovery: null, latestDiscoveryError: "" }).catch(() => {});
  $("discovery").classList.add("hidden");
  $("discovery-list").replaceChildren();
  $("discovery-errors").textContent = "";
}

function updateScope() {
  const all = $("audit-scope").value === "all";
  $("select").textContent = all ? "Scan page" : "Select component";
  if (all) clearSelection();
  else {
    clearDiscovery();
    removeDiscoveryHighlights().catch((error) => setStatus(error.message, "error"));
  }
  setStatus(all ? "Ready to scan this page." : "Ready to select a component.");
}

function showSelection(value) {
  selection = value;
  $("audit-scope").value = "single";
  $("select").textContent = "Select component";
  $("metadata").textContent = JSON.stringify(value, null, 2);
  $("selection").classList.remove("hidden");
  $("result").classList.add("hidden");
  setStatus("Component selected.", "success");
}

function clearRenderedResult() {
  lastAuditReport = null;
  $("result").classList.add("hidden");
  $("result-findings").replaceChildren();
  $("export-excel").classList.add("hidden");
  // $("result-details").textContent = "";
}

function clearSelection() {
  selection = null;
  chrome.storage.local.set({ latestSelection: null, latestSelectionError: "", selectionCancelled: false }).catch(() => {});
  $("selection").classList.add("hidden");
  clearRenderedResult();
  setStatus("Selection cleared.");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  }[character]));
}

function renderFindings(body) {
  $("result-findings").innerHTML = renderFindingsHtml(body);
  /* $("result-findings").innerHTML = groupFindings(body.findings).map((finding) => {
    const scenarios = [...new Set(finding.occurrences.map((item) => item.scenario).filter(Boolean))];
    const title = finding.rule || finding.assertion || finding.target || "Contract finding";
    const details = finding.occurrences.map((item) => `
      <li>
        <strong>${escapeHtml(item.scenario || item.phase || "Observation")}</strong>
        ${item.target ? `<div>Target: ${escapeHtml(item.target)}</div>` : ""}
        ${item.expected !== undefined ? `<div>Expected: ${escapeHtml(JSON.stringify(item.expected))}</div>` : ""}
        ${item.actual !== undefined ? `<div>Actual: ${escapeHtml(JSON.stringify(item.actual))}</div>` : ""}
        ${item.message ? `<div>${escapeHtml(item.message)}</div>` : ""}
      </li>
    `).join("");
    return `<article class="finding severity-${escapeHtml(finding.status)}">
      <p class="finding-title">${escapeHtml(title)}</p>
      <div class="finding-meta">${escapeHtml(finding.status)} · ${escapeHtml(finding.level)} · ${finding.occurrences.length} occurrence(s)</div>
      ${finding.target ? `<div>Target: ${escapeHtml(finding.target)}</div>` : ""}
      ${finding.assertion ? `<div>Assertion: ${escapeHtml(finding.assertion)}</div>` : ""}
      ${finding.expected !== undefined ? `<div>Expected: ${escapeHtml(JSON.stringify(finding.expected))}</div>` : ""}
      ${finding.actual !== undefined ? `<div>Actual: ${escapeHtml(JSON.stringify(finding.actual))}</div>` : ""}
      ${scenarios.length ? `<div>Scenarios: ${escapeHtml(scenarios.join(", "))}</div>` : ""}
      <details><summary>Scenario details (${finding.occurrences.length})</summary><ul>${details}</ul></details>
    </article>`;
  }).join(""); */
}

async function runAudit() {
  if (!selection) throw new Error("Select a combobox first.");
  clearRenderedResult();
  setStatus("Running audit...");
  const { serviceUrl, token, root } = await saveSettings();
  const tab = await activeTab();
  try {
    validateSelectionContext(selection, tab);
  } catch (error) {
    clearSelection();
    throw error;
  }
  const response = await fetch(`${serviceUrl}/api/audits`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(buildAuditRequest({ url: tab.url, root, targetSelector: selection.selector }))
  });
  let body;
  try { body = await response.json(); } catch { throw new Error(`Service returned HTTP ${response.status} without JSON.`); }
  if (response.status === 401) {
    await clearSessionToken();
    $("token").value = "";
  }
  if (!response.ok && response.status !== 422) {
    throw new Error(response.status === 400
      ? "The audit request was rejected. Check the URL, project root, and selector."
      : responseError(response.status, body));
  }
  $("result").classList.remove("hidden");
  $("result-status").textContent = `Audit ${body.status}`;
  $("result-status").className = body.status === "passed" ? "success" : body.status === "skipped" ? "muted" : "error";
  const summary = summarizeResult(body);
  $("result-summary").textContent =
    `Assertion outcomes: ${summary.passed} passed · ${summary.failed} failed · ` +
    `${summary.warnings} warnings · ${summary.skipped} skipped. ` +
    `Findings: ${summary.findingGroups} grouped rules · ${summary.findingOccurrences} observations.`;
  renderFindings(body);
  lastAuditReport = {
    url: tab.url,
    generatedAt: new Date().toISOString(),
    results: [{ target: { component: "combobox", label: "Combobox", selector: selection.selector }, body }]
  };
  $("export-excel").classList.remove("hidden");
  /* $("result-details").textContent = JSON.stringify({
    passes: body.passes || [],
    failures: body.failures || [],
    skipped: body.skipped || [],
    warnings: body.warnings || []
  }, null, 2); */
  setStatus(body.status === "passed" ? "Audit passed." : body.status === "skipped" ? "Audit completed with skipped checks." : "Contract execution completed with failures.", body.status === "passed" ? "success" : "error");
}

async function requestAudit({ serviceUrl, token, root, tab, target }) {
  const response = await fetch(`${serviceUrl}/api/audits`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(buildAuditRequest({
      url: tab.url,
      root,
      component: target.component,
      targetSelector: target.selector
    }))
  });
  let body;
  try { body = await response.json(); } catch { throw new Error(`Service returned HTTP ${response.status} without JSON.`); }
  if (response.status === 401) {
    await clearSessionToken();
    $("token").value = "";
  }
  if (!response.ok && response.status !== 422) throw new Error(responseError(response.status, body));
  return body;
}

async function runAllAudits() {
  if (!discovery?.targets?.length) throw new Error("Scan the page before running audits.");
  const tab = await activeTab();
  validateSelectionContext(discovery, tab);
  const settingsValue = await saveSettings();
  const results = [];
  $("run-all").disabled = true;
  try {
    for (const [index, target] of discovery.targets.entries()) {
      setStatus(`Running audit ${index + 1} of ${discovery.targets.length}: ${target.label}...`);
      results.push({ target, body: await requestAudit({ ...settingsValue, tab, target }) });
    }
  } finally {
    $("run-all").disabled = false;
  }
  const passed = results.filter(({ body }) => body.status === "passed").length;
  $("result").classList.remove("hidden");
  $("result-status").textContent = `Batch audit: ${passed}/${results.length} passed`;
  $("result-status").className = passed === results.length ? "success" : "error";
  $("result-summary").textContent = `${results.length} discovered components audited sequentially.`;
  $("result-findings").innerHTML = results.map(({ target, body }) => `
    <article class="finding severity-${body.status === "passed" ? "pass" : "fail"}">
      <p class="finding-title">${escapeHtml(target.label)} — ${escapeHtml(target.selector)}</p>
      <div class="finding-meta">${escapeHtml(body.status)}</div>
      ${renderFindingsHtml(body)}
    </article>
  `).join("");
  lastAuditReport = { url: tab.url, generatedAt: new Date().toISOString(), results };
  $("export-excel").classList.remove("hidden");
  setStatus("Batch audit complete.", passed === results.length ? "success" : "error");
}

function exportExcelReport() {
  if (!lastAuditReport) throw new Error("Run an audit before downloading a report.");
  const blob = new Blob([buildExcelReport(lastAuditReport)], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = reportFilename(lastAuditReport);
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

$("select").addEventListener("click", () => startSelection().catch((error) => setStatus(error.message, "error")));
$("run").addEventListener("click", () => runAudit().catch((error) => setStatus(error.message, "error")));
$("clear").addEventListener("click", clearSelection);
$("clear-token").addEventListener("click", () => clearToken().catch((error) => setStatus(error.message, "error")));
$("run-all").addEventListener("click", () => runAllAudits().catch((error) => setStatus(error.message, "error")));
$("export-excel").addEventListener("click", () => {
  try { exportExcelReport(); } catch (error) { setStatus(error.message, "error"); }
});
$("clear-discovery").addEventListener("click", () => clearDiscoveryAndHighlights().catch((error) => setStatus(error.message, "error")));
$("audit-scope").addEventListener("change", updateScope);
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === "aria-ease-selection" && sender.tab) {
    showSelection(createSelectionContext(message.selection, sender.tab));
  }
  if (message.type === "aria-ease-selection-cancelled") setStatus("Selection cancelled.");
  if (message.type === "aria-ease-selection-error") setStatus(message.message, "error");
  if (message.type === "aria-ease-discovery" && sender.tab) {
    showDiscovery(createSelectionContext(message.discovery, sender.tab));
  }
  if (message.type === "aria-ease-discovery-error") setStatus(message.message, "error");
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.latestSelection?.newValue) showSelection(changes.latestSelection.newValue);
  if (changes.latestSelectionError?.newValue) setStatus(changes.latestSelectionError.newValue, "error");
  if (changes.selectionCancelled?.newValue) setStatus("Selection cancelled.");
  if (changes.latestDiscovery?.newValue) showDiscovery(changes.latestDiscovery.newValue);
  if (changes.latestDiscoveryError?.newValue) setStatus(changes.latestDiscoveryError.newValue, "error");
});

async function restoreSelectionState() {
  await settings();
  await activeTab();
  const state = await chrome.storage.local.get({
    latestSelection: null,
    latestSelectionError: "",
    selectionCancelled: false,
    latestDiscovery: null,
    latestDiscoveryError: ""
  });
  if (state.latestSelection) showSelection(state.latestSelection);
  else if (state.latestDiscovery) showDiscovery(state.latestDiscovery);
  else if (state.latestSelectionError) setStatus(state.latestSelectionError, "error");
  else if (state.latestDiscoveryError) setStatus(state.latestDiscoveryError, "error");
  else if (state.selectionCancelled) setStatus("Selection cancelled.");
}

restoreSelectionState().catch((error) => setStatus(error.message, "error"));
