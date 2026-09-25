(function () {
  "use strict";

  const DEFAULT_VERSION = "20260925-light-default";
  const DEFAULT_VERSION_KEY = "presentStudio.appearanceDefaultVersion";
  const THEME_KEYS = ["presentStudio.controllerTheme", "presentStudio.audienceTheme"];

  function theme(storageKey) {
    try {
      if (localStorage.getItem(DEFAULT_VERSION_KEY) !== DEFAULT_VERSION) {
        THEME_KEYS.forEach(key => localStorage.setItem(key, "light"));
        localStorage.setItem(DEFAULT_VERSION_KEY, DEFAULT_VERSION);
      }
      return localStorage.getItem(storageKey) === "dark" ? "dark" : "light";
    } catch {
      return "light";
    }
  }

  window.SnapKeyAppearance = { theme };
})();
