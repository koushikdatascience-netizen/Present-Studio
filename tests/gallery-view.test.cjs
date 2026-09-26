const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "frontend", "controller.html"), "utf8");
const liveMedia = fs.readFileSync(path.join(root, "frontend", "js", "live-media.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "frontend", "css", "styles.css"), "utf8");

test("controller exposes one accessible gallery toggle", () => {
  assert.match(html, /data-live-gallery-toggle[^>]+aria-pressed="false"/);
  assert.match(html, /data-live-gallery-expand/);
  assert.match(html, /data-live-gallery-restore/);
});

test("gallery uses the participant panel as a responsive full-stage view", () => {
  assert.match(styles, /\.interactive-workspace\.is-gallery-view[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(styles, /\.interactive-workspace\.is-gallery-view \.live-participant-group-grid[\s\S]*repeat\(auto-fit/);
  assert.match(styles, /\.interactive-workspace\.is-gallery-view \.interactive-main-stage[\s\S]*display:\s*none/);
});

test("gallery restores the stage when a screen share becomes active", () => {
  assert.match(liveMedia, /function setGalleryView\(active, announce = false\)/);
  assert.match(liveMedia, /if \(visible && galleryViewActive\) setGalleryView\(false\)/);
  assert.match(liveMedia, /galleryToggle\?\.addEventListener\("click", \(\) => setGalleryView\(!galleryViewActive, true\)\)/);
});
