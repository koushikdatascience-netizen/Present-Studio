const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../frontend/js/appearance.js"), "utf8");

function appearanceHarness(initial = {}) {
  const values = new Map(Object.entries(initial));
  const context = {
    window: {},
    localStorage: {
      getItem: key => values.has(key) ? values.get(key) : null,
      setItem: (key, value) => values.set(key, String(value))
    }
  };
  vm.runInNewContext(source, context);
  return { appearance: context.window.SnapKeyAppearance, values };
}

test("existing dark preferences are reset to light once", () => {
  const { appearance, values } = appearanceHarness({
    "presentStudio.controllerTheme": "dark",
    "presentStudio.audienceTheme": "dark"
  });

  assert.equal(appearance.theme("presentStudio.controllerTheme"), "light");
  assert.equal(values.get("presentStudio.controllerTheme"), "light");
  assert.equal(values.get("presentStudio.audienceTheme"), "light");
});

test("a later user choice is preserved after the reset", () => {
  const { appearance, values } = appearanceHarness();
  assert.equal(appearance.theme("presentStudio.audienceTheme"), "light");

  values.set("presentStudio.audienceTheme", "dark");
  assert.equal(appearance.theme("presentStudio.audienceTheme"), "dark");
});
