export function validateTargetUrl(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Select a component on an HTTP(S) page.");
  }
  if (["chrome:", "chrome-extension:", "devtools:", "about:"].includes(url.protocol)) {
    throw new Error("Browser-internal pages cannot be audited.");
  }
  return url.href;
}

export function buildAuditRequest({ url, root, targetSelector, component = "combobox" }) {
  return {
    url: validateTargetUrl(url),
    component,
    root,
    targetSelector
  };
}

export function responseError(status, body = {}) {
  if (status === 401) return "Authentication failed. Paste the current service bearer token.";
  if (status === 409) return "The service is busy with another audit.";
  if (status === 422) return "The audit completed but the contract did not pass.";
  return body.error || `Audit service returned HTTP ${status}.`;
}
