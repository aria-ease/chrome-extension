(() => {
  if (globalThis.ariaEaseSelector) return;

  const isElement = (value) => value?.nodeType === 1 && typeof value.getAttribute === "function";
  const cssIdentifier = (value) => /^[A-Za-z_][A-Za-z0-9_-]*$/.test(value);

  function isComboboxElement(element) {
    return isElement(element) && element.getAttribute("role") === "combobox";
  }

  function simpleSelector(element) {
    if (element.id && cssIdentifier(element.id)) return `#${element.id}`;
    const tag = element.localName;
    const classes = [...element.classList].filter(cssIdentifier).slice(0, 2);
    return `${tag}${classes.length ? `.${classes.join(".")}` : ""}`;
  }

  function uniqueElementSelector(element, documentRef = element?.ownerDocument) {
    if (!isElement(element)) throw new Error("A page element is required to generate a selector.");
    if (element.id && cssIdentifier(element.id)) {
      const idSelector = `#${element.id}`;
      if (documentRef.querySelectorAll(idSelector).length === 1) return idSelector;
    }

    const parts = [];
    let current = element;
    while (isElement(current) && current !== documentRef.documentElement) {
      const base = simpleSelector(current);
      const matchingSiblings = current.parentElement
        ? [...current.parentElement.children].filter((candidate) => candidate.matches(base))
        : [];
      const siblingIndex = current.parentElement
        ? [...current.parentElement.children].filter((candidate) => candidate.localName === current.localName).indexOf(current) + 1
        : 0;
      const part = matchingSiblings.length > 1 ? `${base}:nth-of-type(${siblingIndex})` : base;
      parts.unshift(part);
      const candidate = parts.join(" > ");
      if (documentRef.querySelectorAll(candidate).length === 1) return candidate;
      current = current.parentElement;
    }
    throw new Error("Could not generate a unique CSS selector for this component. Add a unique ID and retry.");
  }

  function uniqueSelector(element, documentRef = element?.ownerDocument) {
    if (!isComboboxElement(element)) throw new Error("Select an element with role=\"combobox\".");
    return uniqueElementSelector(element, documentRef);
  }

  function selectedMetadata(element, selector) {
    const attributes = {};
    for (const attribute of element.attributes) {
      if (attribute.name === "role" || attribute.name.startsWith("aria-") || ["id", "name", "title"].includes(attribute.name)) {
        attributes[attribute.name] = attribute.value;
      }
    }
    return {
      selector,
      tag: element.localName,
      id: element.id || null,
      role: element.getAttribute("role"),
      accessibleNameAttributes: {
        ariaLabel: element.getAttribute("aria-label"),
        ariaLabelledby: element.getAttribute("aria-labelledby"),
        title: element.getAttribute("title")
      },
      aria: attributes
    };
  }

  globalThis.ariaEaseSelector = { isComboboxElement, uniqueElementSelector, uniqueSelector, selectedMetadata };
})();
