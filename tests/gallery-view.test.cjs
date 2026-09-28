const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const controllerHtml = fs.readFileSync(path.join(root, "frontend", "controller.html"), "utf8");
const audienceHtml = fs.readFileSync(path.join(root, "frontend", "present.html"), "utf8");
const liveMedia = fs.readFileSync(path.join(root, "frontend", "js", "live-media.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "frontend", "css", "styles.css"), "utf8");

test("controller and audience expose an icon-only accessible People panel maximize control", () => {
  for (const html of [controllerHtml, audienceHtml]) {
    assert.match(html, /data-live-panel-maximize[^>]+aria-pressed="false"/);
    assert.match(html, /data-live-panel-maximize-icon/);
    assert.match(html, /data-live-panel-restore-icon/);
    assert.match(html, /data-tooltip="Maximize people panel"/);
    assert.doesNotMatch(html, /data-live-gallery-toggle/);
  }
});

test("maximized People panel fills the existing meeting workspace in both views", () => {
  assert.match(styles, /\.interactive-workspace\.is-people-panel-maximized[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(styles, /\.present-live-media\.is-connected\.is-people-panel-maximized[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(styles, /\.is-people-panel-maximized \.interactive-main-stage[\s\S]*display:\s*none/);
  assert.match(styles, /\.is-people-panel-maximized \.audience-meeting-stage[\s\S]*display:\s*none/);
});

test("maximize toggles back to the unchanged sidebar and does not retain gallery behavior", () => {
  assert.match(liveMedia, /function setPeoplePanelMaximized\(active, announce = false\)/);
  assert.match(liveMedia, /root\.classList\.toggle\("is-people-panel-maximized", peoplePanelMaximized\)/);
  assert.match(liveMedia, /panelMaximizeButton\?\.addEventListener\("click", \(\) => setPeoplePanelMaximized\(!peoplePanelMaximized, true\)\)/);
  assert.doesNotMatch(liveMedia, /setGalleryView|galleryViewActive/);
});
