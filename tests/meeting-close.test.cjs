const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const controllerHtml = fs.readFileSync(path.join(__dirname, "../frontend/controller.html"), "utf8");
const controller = fs.readFileSync(path.join(__dirname, "../frontend/js/controller.js"), "utf8");
const liveMedia = fs.readFileSync(path.join(__dirname, "../frontend/js/live-media.js"), "utf8");

test("controller provides a hidden owner-only close meeting control", () => {
  assert.match(controllerHtml, /data-live-close hidden disabled/);
  assert.match(controller, /cachedUser\.id !== presentation\.ownerId/);
  assert.match(controller, /closeMeetingButton\.hidden = isCohost/);
});

test("closing confirms, emits the owner close event, and handles session end", () => {
  assert.match(liveMedia, /Close this meeting for everyone\?/);
  assert.match(liveMedia, /emit\("meeting_close", moderationCredentials\(\)\)/);
  assert.match(liveMedia, /on\("session_ended"[\s\S]*Everyone has been disconnected/);
  assert.match(controller, /meetingClosed = true/);
  assert.match(controller, /function emitControllerState\(\) \{\s*if \(meetingClosed\) return;/);
});
