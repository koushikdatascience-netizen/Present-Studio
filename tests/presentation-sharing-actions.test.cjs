const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const dashboardHtml = fs.readFileSync(path.join(__dirname, "../frontend/dashboard.html"), "utf8");
const dashboard = fs.readFileSync(path.join(__dirname, "../frontend/js/dashboard.js"), "utf8");
const viewerHtml = fs.readFileSync(path.join(__dirname, "../frontend/viewer.html"), "utf8");

test("dashboard exposes read-only sharing and presentation download on each deck card", () => {
  assert.match(dashboard, /data-share-presentation=.*Share read-only link/);
  assert.match(dashboard, /data-download-presentation=.*Download HTML presentation/);
  assert.match(dashboard, /openPresentationShare\(button\.dataset\.sharePresentation\)/);
  assert.match(dashboard, /downloadPresentation\(button\.dataset\.downloadPresentation, button\)/);
  assert.match(dashboardHtml, /id="presentationShareDialog"/);
});

test("shared presentation viewer offers only slide navigation and autoplay", () => {
  assert.match(viewerHtml, /id="viewerPrevious"/);
  assert.match(viewerHtml, /id="viewerNext"/);
  assert.match(viewerHtml, /id="viewerAutoplay"/);
  assert.doesNotMatch(viewerHtml, /meeting|audience|controller|projector/i);
});
