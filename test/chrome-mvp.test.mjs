import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { buildAuditRequest, responseError, validateTargetUrl } from "../chrome-mvp/request.mjs";
import { groupFindings, summarizeResult, renderFindingsHtml } from "../chrome-mvp/findings.mjs";

const manifest = JSON.parse(await readFile(new URL("../chrome-mvp/manifest.json", import.meta.url)));

test("MV3 manifest uses least-privilege selection permissions and local service hosts", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions.sort(), ["activeTab", "scripting", "storage"]);
  assert.ok(manifest.host_permissions.includes("http://127.0.0.1/*"));
  assert.ok(!manifest.host_permissions.includes("<all_urls>"));
});

test("audit requests contain the existing service shape and reject unsafe URLs", () => {
  assert.deepEqual(buildAuditRequest({
    url: "https://example.test/page",
    root: "/Users/macx/aria-ease/exprmnts",
    targetSelector: "#search"
  }), {
    url: "https://example.test/page",
    component: "combobox",
    root: "/Users/macx/aria-ease/exprmnts",
    targetSelector: "#search"
  });
  for (const url of ["data:text/html,hi", "javascript:alert(1)", "file:///tmp/a", "chrome://settings"]) {
    assert.throws(() => validateTargetUrl(url), /HTTP\(S\)|internal/);
  }
});

test("service errors remain actionable and contract failures are not execution errors", () => {
  assert.match(responseError(401), /Authentication/);
  assert.match(responseError(409), /busy/);
  assert.match(responseError(422), /contract/);
});

test("selection code prevents page activation and cleans up its listeners", async () => {
  const source = await readFile(new URL("../chrome-mvp/content-script.js", import.meta.url), "utf8");
  assert.match(source, /preventDefault/);
  assert.match(source, /stopImmediatePropagation/);
  assert.match(source, /removeEventListener/);
  assert.match(source, /Escape/);
  assert.match(source, /aria-ease-selection-ready/);
  assert.match(source, /\.catch\(\(\) => \{\}\)/);
});

test("popup uses session-scoped token storage and sends bearer authentication", async () => {
  const source = await readFile(new URL("../chrome-mvp/popup.js", import.meta.url), "utf8");
  assert.match(source, /saveSessionToken/);
  assert.match(source, /clearSessionToken/);
  assert.match(source, /Authorization: `Bearer \$\{token\}`/);
  assert.match(source, /targetSelector/);
});

test("popup trims the token before constructing the authenticated request", async () => {
  const source = await readFile(new URL("../chrome-mvp/popup.js", import.meta.url), "utf8");
  assert.match(source, /const token = \$\("token"\)\.value\.trim\(\)/);
  assert.match(source, /Authorization: `Bearer \$\{token\}`/);
  assert.match(source, /scripting\.executeScript/);
  assert.doesNotMatch(source, /tabs\.sendMessage/);
  assert.match(source, /storage\.onChanged/);
});

test("the service worker is the durable receiver for selection events", async () => {
  const source = await readFile(new URL("../chrome-mvp/background.js", import.meta.url), "utf8");
  assert.match(source, /chrome\.runtime\.onMessage\.addListener/);
  assert.match(source, /latestSelection/);
  assert.match(source, /latestSelectionError/);
  assert.match(source, /selectionCancelled/);
});

test("popup supports contextual all-component discovery without starting batch audits", async () => {
  const [html, popup, background, discovery] = await Promise.all([
    readFile(new URL("../chrome-mvp/popup.html", import.meta.url), "utf8"),
    readFile(new URL("../chrome-mvp/popup.js", import.meta.url), "utf8"),
    readFile(new URL("../chrome-mvp/background.js", import.meta.url), "utf8"),
    readFile(new URL("../chrome-mvp/discover-components.js", import.meta.url), "utf8")
  ]);
  assert.match(html, /value="all">All supported components/);
  assert.match(html, /id="discovery-list"/);
  assert.match(popup, /discover-components\.js/);
  assert.match(popup, /latestDiscovery/);
  assert.match(background, /createSelectionContext\(message\.discovery, sender\.tab\)/);
  assert.match(discovery, /strategies\.discover\(document\)/);
  assert.match(discovery, /uniqueElementSelector/);
});

test("discovered components are highlighted and can be cleared", async () => {
  const [html, popup, discovery, cleanup] = await Promise.all([
    readFile(new URL("../chrome-mvp/popup.html", import.meta.url), "utf8"),
    readFile(new URL("../chrome-mvp/popup.js", import.meta.url), "utf8"),
    readFile(new URL("../chrome-mvp/discover-components.js", import.meta.url), "utf8"),
    readFile(new URL("../chrome-mvp/clear-discovery-highlights.js", import.meta.url), "utf8")
  ]);
  assert.match(html, /id="clear-discovery"/);
  assert.match(popup, /clear-discovery-highlights\.js/);
  assert.match(discovery, /aria-ease-discovered-component/);
  assert.match(discovery, /outline: 3px solid #2563eb/);
  assert.match(discovery, /badge\.textContent = candidate\.label/);
  assert.match(cleanup, /classList\.remove/);
  assert.match(cleanup, /highlight-style/);
});

test("all-component discovery exposes sequential batch execution", async () => {
  const [html, popup] = await Promise.all([
    readFile(new URL("../chrome-mvp/popup.html", import.meta.url), "utf8"),
    readFile(new URL("../chrome-mvp/popup.js", import.meta.url), "utf8")
  ]);
  assert.match(html, /id="run-all"/);
  assert.match(popup, /async function runAllAudits/);
  assert.match(popup, /for \(const \[index, target\] of discovery\.targets\.entries\(\)\)/);
  assert.match(popup, /component: target\.component/);
});

test("popup displays the active tab URL as a read-only audit target", async () => {
  const [html, popup] = await Promise.all([
    readFile(new URL("../chrome-mvp/popup.html", import.meta.url), "utf8"),
    readFile(new URL("../chrome-mvp/popup.js", import.meta.url), "utf8")
  ]);
  assert.match(html, /id="page-url"[^>]*readonly/);
  assert.match(html, /Automatically taken from the active tab/);
  assert.match(popup, /\$\("page-url"\)\.value = tabs\[0\]\.url/);
  assert.match(popup, /async function restoreSelectionState[\s\S]*await activeTab\(\)/);
});

test("groups repeated rule findings without merging distinct targets or expectations", () => {
  const findings = [
    { id: "combo:dynamic:dynamic[0].assertions[0]", status: "fail", target: "input", expected: "true", scenario: "opens", message: "first" },
    { id: "combo:dynamic:dynamic[0].assertions[0]", status: "fail", target: "input", expected: "true", scenario: "closes", message: "second" },
    { id: "combo:dynamic:dynamic[0].assertions[0]", status: "fail", target: "popup", expected: "true", scenario: "opens", message: "different target" },
    { id: "combo:dynamic:dynamic[0].assertions[1]", status: "fail", target: "input", expected: "true", scenario: "opens", message: "different rule" }
  ];
  const groups = groupFindings(findings);
  assert.equal(groups.length, 3);
  assert.equal(groups[0].occurrences.length, 2);
  assert.deepEqual(groups[0].occurrences.map(({ scenario }) => scenario), ["opens", "closes"]);
});

test("summarizes assertion outcomes separately from grouped findings", () => {
  const summary = summarizeResult({
    passes: ["p1", "p2"],
    failures: ["f1"],
    warnings: ["w1"],
    skipped: [],
    findings: [
      { id: "rule-1", status: "fail", scenario: "one" },
      { id: "rule-1", status: "fail", scenario: "two" },
      { id: "rule-2", status: "warn", scenario: "one" }
    ]
  });
  assert.deepEqual(summary, {
    passed: 2, failed: 1, warnings: 1, skipped: 0,
    findingGroups: 2, findingOccurrences: 3
  });
});

test("renders dynamic service findings through the popup renderer", () => {
  const html = renderFindingsHtml({
    findings: [
      { id: "contract:dynamic:dynamic[0].assertions[1]", status: "fail", level: "required", phase: "dynamic", rule: "dynamic[0].assertions[1]", assertion: "toHaveAttribute", scenario: "Arrow opens the combobox.", target: "main", expected: "true", actual: "false", message: "Expected expanded combobox." },
      { id: "contract:dynamic:dynamic[1].assertions[0]", status: "fail", level: "required", phase: "dynamic", rule: "dynamic[1].assertions[0]", scenario: "Escape clears active option.", target: "main", expected: "apple", actual: null, message: "Expected active option." },
      { id: "contract:dynamic:dynamic[2].assertions[0]", status: "fail", level: "required", phase: "dynamic", rule: "dynamic[2].assertions[0]", scenario: "Escape clears input.", target: "input", expected: "", actual: "test", message: "Expected empty input." },
      { id: "contract:dynamic:dynamic[3].assertions[0]", status: "fail", level: "required", phase: "dynamic", rule: "dynamic[3].assertions[0]", scenario: "Enter selects active option.", target: "relative", expected: "true", actual: null, message: "Expected selected option." }
    ]
  });
  assert.match(html, /dynamic\[0\]\.assertions\[1\]/);
  assert.match(html, /Arrow opens the combobox/);
  assert.match(html, /Expected: &quot;true&quot;/);
  assert.match(html, /Actual: &quot;false&quot;/);
  assert.match(html, /Escape clears active option/);
  assert.match(html, /Expected: &quot;apple&quot;/);
  assert.match(html, /Escape clears input/);
  assert.match(html, /Actual: &quot;test&quot;/);
  assert.match(html, /Enter selects active option/);
  assert.match(html, /Scenario details \(1\)/);
});

test("popup renders every structured finding and keeps legacy checks visible", async () => {
  const source = await readFile(new URL("../chrome-mvp/popup.js", import.meta.url), "utf8");
  assert.match(source, /renderFindingsHtml/);
  assert.match(source, /Assertion outcomes/);
  assert.match(source, /findingOccurrences/);
  assert.match(source, /body\.findings/);
  assert.match(source, /passes: body\.passes/);
  assert.match(source, /failures: body\.failures/);
  assert.match(source, /clearRenderedResult/);
  assert.match(source, /replaceChildren/);
});
