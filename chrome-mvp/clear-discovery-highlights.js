(() => {
  document.querySelectorAll(".aria-ease-discovered-component").forEach((element) => {
    element.classList.remove("aria-ease-discovered-component");
    element.removeAttribute("data-aria-ease-discovered-type");
  });
  document.getElementById("aria-ease-discovery-highlight-style")?.remove();
  document.querySelectorAll(".aria-ease-discovery-label").forEach((element) => element.remove());
})();
