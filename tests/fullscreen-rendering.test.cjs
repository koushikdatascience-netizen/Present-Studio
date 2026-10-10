const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const styles = fs.readFileSync(path.join(__dirname, "../frontend/css/styles.css"), "utf8");
const controller = fs.readFileSync(path.join(__dirname, "../frontend/js/controller.js"), "utf8");
const present = fs.readFileSync(path.join(__dirname, "../frontend/js/present.js"), "utf8");
const liveMedia = fs.readFileSync(path.join(__dirname, "../frontend/js/live-media.js"), "utf8");
const controllerHtml = fs.readFileSync(path.join(__dirname, "../frontend/controller.html"), "utf8");
const presentHtml = fs.readFileSync(path.join(__dirname, "../frontend/present.html"), "utf8");

test("fullscreen stages isolate their canvas and media paint layers", () => {
  assert.match(styles, /\.controller-preview-stage:fullscreen\s*\{[^}]*isolation:\s*isolate;[^}]*contain:\s*layout paint;/s);
  assert.match(styles, /\.interactive-main-stage:fullscreen,[\s\S]*?isolation:\s*isolate;[\s\S]*?contain:\s*layout paint;/);
  assert.match(styles, /\.controller-preview-stage:fullscreen \.controller-preview-visual\s*\{[^}]*inset:\s*0;[^}]*width:\s*100%;[^}]*height:\s*100%;/s);
});

test("default fullscreen rendering does not force GPU transforms", () => {
  assert.match(styles, /\.controller-preview-visual\.has-viewport-transform\s*\{\s*transform:/);
  assert.match(styles, /\.live-presentation-feed-frame\.has-viewport-transform[^}]+transform:/s);
  assert.match(controller, /visual\.classList\.toggle\("has-viewport-transform"/);
  assert.match(controller, /frame\?\.classList\.toggle\("has-viewport-transform"/);
  assert.match(present, /view\.classList\.toggle\("has-viewport-transform"/);
});

test("fullscreen entry repaints and interactive exit clears viewport transforms", () => {
  assert.match(controller, /requestAnimationFrame\(\(\) => previewCanvas\?\.requestRenderAll\(\)\)/);
  assert.match(controller, /interactiveToolZoom = 1;[\s\S]*interactiveToolPan = \{ x: 0, y: 0 \};[\s\S]*applyInteractiveToolViewport\(\)/);
});

test("both fullscreen experiences provide an in-stage exit control", () => {
  assert.match(controllerHtml, /id="previewExitFullscreen"/);
  assert.match(controllerHtml, /interactive-main-stage[\s\S]*data-live-fullscreen-exit/);
  assert.match(presentHtml, /audience-meeting-stage[\s\S]*data-live-fullscreen-exit/);
  assert.match(controller, /previewExitFullscreen[\s\S]*document\.exitFullscreen/);
  assert.match(liveMedia, /fullscreenExitButton[\s\S]*document\.exitFullscreen/);
});

test("every participant hides their own screen-share preview to prevent capture recursion", () => {
  assert.match(liveMedia, /isHiddenLocalShare\s*=\s*participant\s*=>\s*participant\s*===\s*room\.localParticipant/);
  assert.match(liveMedia, /Local preview is hidden to prevent a recursive screen-capture loop/);
  assert.match(styles, /\.live-local-share-placeholder/);
});
