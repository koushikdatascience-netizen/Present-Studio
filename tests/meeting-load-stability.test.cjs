const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const controller = fs.readFileSync(path.join(__dirname, "../frontend/js/controller.js"), "utf8");
const liveMedia = fs.readFileSync(path.join(__dirname, "../frontend/js/live-media.js"), "utf8");

test("controllers apply canonical state without competing periodic heartbeats", () => {
  assert.match(controller, /function applyCanonicalControllerState\(state\)/);
  assert.match(controller, /socket\?\.on\("presentation_state", applyCanonicalControllerState\)/);
  assert.doesNotMatch(controller, /setInterval\(emitControllerState/);
});

test("participant audio tracks survive camera and screen-share UI updates", () => {
  assert.match(liveMedia, /function syncParticipantAudio\(tile, participant, isLocal = false\)/);
  assert.match(liveMedia, /const preservedAudio = tile \? \[\.\.\.tile\.querySelectorAll\("audio\[data-live-audio-track\]"\)\] : \[\]/);
  assert.doesNotMatch(liveMedia, /meetingMuted, mutedParticipants\.has\(participant\.identity\),\s*selectedCameraIdentity/);
  assert.match(liveMedia, /isSource\(publication, "Camera"\) \|\| isSource\(publication, "Microphone"\)/);
});
