const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "../frontend/controller.html"), "utf8");
const styles = fs.readFileSync(path.join(__dirname, "../frontend/css/styles.css"), "utf8");
const controller = fs.readFileSync(path.join(__dirname, "../frontend/js/controller.js"), "utf8");

test("presenter ribbon controls expose icon tooltips and accessible labels", () => {
  for (const id of ["pauseMedia", "previewAudio", "replayMedia", "openWhiteboard", "stopMedia", "openScreen"]) {
    assert.match(html, new RegExp(`<button[^>]+id="${id}"[^>]+aria-label="[^"]+"[^>]+data-tooltip="[^"]+"`));
  }
  assert.match(styles, /content:\s*attr\(data-tooltip\)/);
  assert.match(styles, /\.controller-control-ribbon strong\s*\{[^}]*clip-path:\s*inset\(50%\)/s);
});

test("dynamic presenter controls keep their tooltip labels synchronized", () => {
  assert.match(controller, /pauseButton\.dataset\.tooltip\s*=\s*playbackLabel/);
  assert.match(controller, /audioButton\.dataset\.tooltip\s*=\s*audioLabel/);
  assert.match(controller, /launchButton\.dataset\.tooltip\s*=\s*previewWhiteboardActive/);
});
