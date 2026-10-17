(() => {
  if (window.__ariaEaseSelectionActive) return;
  window.__ariaEaseSelectionActive = true;
  const overlay = document.createElement("div");
  overlay.setAttribute("data-aria-ease-selector-overlay", "true");
  Object.assign(overlay.style, {
    position: "fixed",
    zIndex: "2147483647",
    pointerEvents: "none",
    border: "2px solid #2563eb",
    background: "rgba(37, 99, 235, 0.12)",
    display: "none"
  });
  document.documentElement.appendChild(overlay);

  const describe = (element) => {
    const selector = window.ariaEaseSelector.uniqueSelector(element);
    return window.ariaEaseSelector.selectedMetadata(element, selector);
  };

  const move = (event) => {
    const element = event.target instanceof Element ? event.target : null;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    Object.assign(overlay.style, {
      display: "block",
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`
    });
  };

  const click = (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      const element = event.target instanceof Element
        ? event.target.closest('[role="combobox"]')
        : null;
      if (!element || element.getAttribute("role") !== "combobox") {
        throw new Error("Select a combobox (an element with role=\"combobox\").");
      }
      const selector = window.ariaEaseSelector.uniqueSelector(element);
      chrome.runtime.sendMessage({ type: "aria-ease-selection", selection: window.ariaEaseSelector.selectedMetadata(element, selector) }).catch(() => {});
      cleanup();
    } catch (error) {
      chrome.runtime.sendMessage({ type: "aria-ease-selection-error", message: error instanceof Error ? error.message : String(error) }).catch(() => {});
    }
  };

  const keydown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      chrome.runtime.sendMessage({ type: "aria-ease-selection-cancelled" }).catch(() => {});
      cleanup();
    }
  };

  const cleanup = () => {
    document.removeEventListener("mousemove", move, true);
    document.removeEventListener("click", click, true);
    document.removeEventListener("keydown", keydown, true);
    overlay.remove();
    delete window.ariaEaseSelector;
    delete window.ariaEaseComponentStrategies;
    window.__ariaEaseSelectionActive = false;
  };

  document.addEventListener("mousemove", move, true);
  document.addEventListener("click", click, true);
  document.addEventListener("keydown", keydown, true);
  chrome.runtime.sendMessage({ type: "aria-ease-selection-ready" }).catch(() => {});
})();
