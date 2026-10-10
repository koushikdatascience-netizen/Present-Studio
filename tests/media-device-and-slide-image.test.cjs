const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const builder = fs.readFileSync(path.join(root, "frontend/js/editor.js"), "utf8");
const builderUi = fs.readFileSync(path.join(root, "frontend/js/builder-ui.js"), "utf8");
const liveMedia = fs.readFileSync(path.join(root, "frontend/js/live-media.js"), "utf8");
const audienceHtml = fs.readFileSync(path.join(root, "frontend/present.html"), "utf8");
const controllerHtml = fs.readFileSync(path.join(root, "frontend/controller.html"), "utf8");

test("failed slide images do not become canvas objects or abort canvas loading", () => {
  assert.match(builder, /if\(!o\|\|!o\.width\|\|!o\.height\)/);
  assert.match(builder, /Check the media link or upload it again/);
  assert.match(builderUi, /slide-thumbnail-image-error/);
  assert.match(builderUi, /image\.naturalWidth === 0/);
});

test("camera acquisition errors give device-specific guidance", () => {
  assert.match(liveMedia, /NotFoundError:\s*"No camera was found/);
  assert.match(liveMedia, /NotAllowedError:\s*"Camera access is blocked/);
  assert.match(liveMedia, /requested device not found\|camera\|video/i);
});

test("local meeting recording is only exposed on the controller, not the audience page", () => {
  assert.match(controllerHtml, /controllerRecordButton/);
  assert.doesNotMatch(audienceHtml, /controllerRecordButton|Record meeting locally/);
});
