(() => {
  if (globalThis.ariaEaseComponentStrategies) return;

  const definitions = Object.freeze({
    combobox: Object.freeze({
      type: "combobox",
      label: "Combobox",
      rootSelector: '[role="combobox"]',
      automatic: true
    }),
    radio: Object.freeze({
      type: "radio",
      label: "Radio group",
      rootSelector: '[role="radiogroup"]',
      automatic: true
    }),
    tabs: Object.freeze({
      type: "tabs",
      label: "Tabs",
      rootSelector: '[role="tablist"]',
      automatic: true
    }),
    checkbox: Object.freeze({
      type: "checkbox",
      label: "Checkbox group",
      rootSelector: '[data-aria-ease-component="checkbox"], [role="group"]:has([role="checkbox"])',
      automatic: true
    }),
    menu: Object.freeze({
      type: "menu",
      label: "Menu",
      rootSelector: '[aria-haspopup="menu"][aria-expanded], [aria-haspopup="true"][aria-expanded]',
      automatic: true
    }),
    accordion: Object.freeze({
      type: "accordion",
      label: "Accordion",
      rootSelector: '[data-aria-ease-component="accordion"]',
      automatic: false
    }),
    toggle: Object.freeze({
      type: "toggle",
      label: "Toggle",
      rootSelector: '[data-aria-ease-component="toggle"], [aria-pressed]',
      automatic: false
    }),
    block: Object.freeze({
      type: "block",
      label: "Block navigation",
      rootSelector: '[data-aria-ease-component="block"]',
      automatic: false
    })
  });

  function get(type) {
    const strategy = definitions[type];
    if (!strategy) throw new Error(`Unsupported component type: ${type}`);
    return strategy;
  }

  function list({ automaticOnly = false } = {}) {
    const strategies = Object.values(definitions);
    return automaticOnly ? strategies.filter((strategy) => strategy.automatic) : strategies;
  }

  function resolveTarget(element, type) {
    if (!element || typeof element.closest !== "function") return null;
    return element.closest(get(type).rootSelector);
  }

  function discover(documentRef, { automaticOnly = true } = {}) {
    const targets = [];
    for (const strategy of list({ automaticOnly })) {
      for (const element of documentRef.querySelectorAll(strategy.rootSelector)) {
        targets.push({ component: strategy.type, label: strategy.label, element });
      }
    }
    return targets;
  }

  globalThis.ariaEaseComponentStrategies = Object.freeze({ definitions, get, list, resolveTarget, discover });
})();
