function safeText(value) {
  const text = String(value ?? "");
  const formulaSafe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return formulaSafe.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  }[character]));
}

function list(value) {
  return Array.isArray(value) ? value.join("\n") : "";
}

function guidance(message) {
  if (/Relationship target not found: popup/i.test(message)) return {
    explanation: "The menu trigger references a popup that the audit page could not locate.",
    remediation: "Ensure aria-controls points to the ID of a rendered element with role=\"menu\"."
  };
  if (/Relationship parent target not found: popup|Target popup not found/i.test(message)) return {
    explanation: "The menu popup was not present when the contract checked its relationships.",
    remediation: "Render the menu popup in the fresh audit page and connect it to the trigger with aria-controls."
  };
  if (/aria-expanded.*should be.*false.*found.*true/i.test(message)) return {
    explanation: "The menu loaded in an expanded state while the contract expected it to start closed.",
    remediation: "Initialize aria-expanded=\"false\" and keep it synchronized with the popup visibility."
  };
  if (/Target items not found|items element not found/i.test(message)) return {
    explanation: "No elements matching the contract's menu-item selector were found inside the menu.",
    remediation: "Add role=\"menuitem\", role=\"menuitemcheckbox\", or role=\"menuitemradio\" to the interactive menu items."
  };
  if (/Could not resolve relative target.*focus/i.test(message)) return {
    explanation: "The interaction scenario could not identify the requested menu item to receive focus.",
    remediation: "Ensure the menu renders enough correctly marked menu items before focus-navigation tests run."
  };
  return { explanation: message, remediation: "Review the component contract, rendered markup, and audit-page state for this scenario." };
}

function legacyFindings(body) {
  const failures = Array.isArray(body.failures) ? body.failures : [];
  if (!failures.length) return [{ message: body.status === "passed" ? "No failures detected." : "No diagnostic was returned.", occurrences: 1 }];
  const grouped = new Map();
  for (const message of failures) {
    const current = grouped.get(message) || { message, occurrences: 0 };
    current.occurrences += 1;
    grouped.set(message, current);
  }
  return [...grouped.values()];
}

export function reportRows(report) {
  return report.results.flatMap(({ target, body }) => {
    const findings = Array.isArray(body.findings) && body.findings.length ? body.findings : legacyFindings(body);
    return findings.map((finding) => {
      const rawMessage = finding.message || list(body.failures);
      const diagnostic = guidance(rawMessage);
      return {
      component: target.label || target.component,
      selector: target.selector,
      status: finding.status || body.status,
      level: finding.level || "",
      rule: finding.rule || finding.assertion || "",
      scenario: finding.scenario || finding.phase || "",
      message: diagnostic.explanation,
      remediation: diagnostic.remediation,
      expected: finding.expected === undefined ? "" : JSON.stringify(finding.expected),
      actual: finding.actual === undefined ? "" : JSON.stringify(finding.actual),
      occurrences: finding.occurrences || 1
    };
    });
  });
}

export function buildExcelReport(report) {
  const rows = reportRows(report);
  const passed = report.results.filter(({ body }) => body.status === "passed").length;
  const failed = report.results.length - passed;
  const headers = ["Component", "Selector", "Status", "Level", "Rule", "Scenario", "Why it failed", "How to fix", "Expected", "Actual", "Occurrences"];
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:Calibri,Arial,sans-serif;color:#172033}table{border-collapse:collapse;width:100%}
    th,td{border:1px solid #cbd5e1;padding:7px;vertical-align:top;white-space:pre-wrap}
    th{background:#1d4ed8;color:#fff;font-weight:700}.summary th{background:#e8eefc;color:#172033}
    .passed{background:#dcfce7;color:#166534}.failed,.fail{background:#fee2e2;color:#991b1b}.warn{background:#fef3c7;color:#92400e}
  </style></head><body>
    <h1>Aria-Ease accessibility audit</h1>
    <table class="summary">
      <tr><th>Page URL</th><td colspan="3">${safeText(report.url)}</td></tr>
      <tr><th>Generated</th><td>${safeText(report.generatedAt)}</td><th>Components</th><td>${report.results.length}</td></tr>
      <tr><th>Passed</th><td class="passed">${passed}</td><th>Failed</th><td class="failed">${failed}</td></tr>
    </table>
    <h2>Detailed findings</h2>
    <table><thead><tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead><tbody>
      ${rows.map((row) => `<tr>${Object.values(row).map((value, index) => `<td${index === 2 ? ` class="${safeText(value)}"` : ""}>${safeText(value)}</td>`).join("")}</tr>`).join("")}
    </tbody></table>
  </body></html>`;
}

export function reportFilename(report) {
  const date = new Date(report.generatedAt).toISOString().replace(/[:.]/g, "-");
  return `aria-ease-audit-${date}.xls`;
}
