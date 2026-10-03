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
  assert.match(liveMedia, /audio && \(audio\._liveTrack !== publication\.track \|\| !audio\.isConnected\)/);
  assert.doesNotMatch(liveMedia, /tile\.append\(audio\)/);
  assert.doesNotMatch(liveMedia, /meetingMuted, mutedParticipants\.has\(participant\.identity\),\s*selectedCameraIdentity/);
  assert.match(liveMedia, /function syncParticipantTileStatus\(tile, participant, facts\)/);
  assert.match(liveMedia, /const publicationState = publications\(participant\)\.filter\(publication =>\s*isSource\(publication, "Camera"\)/);
  assert.doesNotMatch(liveMedia, /const publicationState = publications\(participant\)\.filter\(publication =>\s*isSource\(publication, "Camera"\) \|\| isSource\(publication, "Microphone"\)/);
});

test("participant directory provides stable priority ordering, search, and status filters", () => {
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
  assert.match(liveMedia, /\["people", "Participants"\]/);
  assert.match(liveMedia, /Number\(right\.facts\.presenter\) - Number\(left\.facts\.presenter\)/);
  assert.match(liveMedia, /Number\(right\.facts\.screenSharing\) - Number\(left\.facts\.screenSharing\)/);
  assert.match(liveMedia, /left\.facts\.name\.localeCompare\(right\.facts\.name/);
  assert.doesNotMatch(liveMedia, /\["speaking", "Speaking now"\]/);
  assert.doesNotMatch(liveMedia, /\["unmuted", "Mic on"\]/);
  assert.match(liveMedia, /participantSearchQuery/);
  assert.match(liveMedia, /speakerReleaseTimers/);
  assert.match(liveMedia, /}, 3500\)/);
  assert.match(liveMedia, /function setAudienceToolsOpen\(open, moveFocus = false\)/);
});

test("meeting dock controls expose distinct on, off, and tab speaker states", () => {
  const styles = fs.readFileSync(path.join(__dirname, "../frontend/css/styles.css"), "utf8");
  assert.match(liveMedia, /className = "live-control-button is-tab-speaker"/);
  assert.match(styles, /\.live-control-button:is\(\.is-microphone,\.is-camera\)\[aria-pressed="true"\][\s\S]*background:\s*#1f9f5a/);
  assert.match(styles, /\.live-control-button:is\(\.is-microphone,\.is-camera\)\[aria-pressed="false"\]:not\(:disabled\)[\s\S]*background:\s*#35201e/);
  assert.match(styles, /\.live-control-button\.is-tab-speaker\[aria-pressed="true"\][\s\S]*background:\s*#35201e/);
  assert.match(styles, /\.live-control-button\.is-tab-speaker\[aria-pressed="false"\][\s\S]*background:\s*#193329/);
});
