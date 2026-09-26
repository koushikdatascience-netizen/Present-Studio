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
  assert.match(liveMedia, /function syncParticipantAudio\(participant, isLocal = false\)/);
  assert.match(liveMedia, /audioMount\.append\(audio\)/);
  assert.doesNotMatch(liveMedia, /tile\.append\(audio\)/);
  assert.doesNotMatch(liveMedia, /meetingMuted, mutedParticipants\.has\(participant\.identity\),\s*selectedCameraIdentity/);
  assert.match(liveMedia, /isSource\(publication, "Camera"\) \|\| isSource\(publication, "Microphone"\)/);
});

test("participant directory provides stable groups, search, and status filters", () => {
  const controllerHtml = fs.readFileSync(path.join(__dirname, "../frontend/controller.html"), "utf8");
  const audienceHtml = fs.readFileSync(path.join(__dirname, "../frontend/present.html"), "utf8");
  for (const html of [controllerHtml, audienceHtml]) {
    assert.match(html, /data-live-people-search/);
    assert.match(html, /data-live-more-action="audiences"/);
    assert.match(html, /data-live-audience-tools-popover/);
    for (const filter of ["all", "speaking", "hands", "unmuted", "camera"]) {
      assert.match(html, new RegExp(`data-live-people-filter="${filter}"`));
    }
  }
  assert.match(liveMedia, /\["speaking", "Speaking now"\]/);
  assert.match(liveMedia, /\["presenters", "Presenters"\]/);
  assert.match(liveMedia, /\["audience", "Audience"\]/);
  assert.match(liveMedia, /participantSearchQuery/);
  assert.match(liveMedia, /speakerReleaseTimers/);
  assert.match(liveMedia, /}, 3500\)/);
  assert.match(liveMedia, /function setAudienceToolsOpen\(open, moveFocus = false\)/);
});
