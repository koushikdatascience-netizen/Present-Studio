const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "../frontend/present.html"), "utf8");
const script = fs.readFileSync(path.join(__dirname, "../frontend/js/audience-recording.js"), "utf8");

test("audience can start, pause, stop, and download a local tab recording", () => {
  assert.match(html, /data-audience-record-open/);
  assert.match(html, /data-audience-record-start/);
  assert.match(html, /data-audience-record-pause/);
  assert.match(html, /data-audience-record-stop/);
  assert.match(script, /getDisplayMedia\(/);
  assert.match(script, /recorder\.pause\(\)/);
  assert.match(script, /recorder\.resume\(\)/);
  assert.match(script, /recorder\.stop\(\)/);
  assert.match(script, /link\.download = .*\.\$\{extension\}/);
});

test("audience recorder tells users it records locally and tab audio is optional", () => {
  assert.match(html, /recording stays on your device/i);
  assert.match(html, /let other participants know/i);
  assert.match(script, /audio: true/);
  assert.match(script, /without audio/);
});
