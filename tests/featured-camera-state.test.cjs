const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const liveMediaSource = fs.readFileSync(path.join(__dirname, "../frontend/js/live-media.js"), "utf8");
const helperStart = liveMediaSource.indexOf("    function publishControllerState");
const helperEnd = liveMediaSource.indexOf("    function presentationSourceLabel", helperStart);
const helperSource = liveMediaSource.slice(helperStart, helperEnd);

function stateHarness({ controller = false } = {}) {
  const emitted = [];
  let renders = 0;
  const context = {
    isController: controller,
    controllerShareIdentity: "screen-owner",
    selectedCameraIdentity: "camera-owner",
    meetingMuted: false,
    mutedParticipants: new Set(),
    room: null,
    options: {
      presentationId: "presentation-1",
      authToken: "token",
      shareToken: "",
      socket: { emit: (...args) => emitted.push(args) }
    },
    applyRemoteAudioState() {},
    renderParticipants() { renders += 1; },
    nonPresenterRemoteIdentities() { return []; },
    recomputeMeetingMuted() {}
  };
  vm.runInNewContext(`${helperSource}; this.publishControllerState = publishControllerState; this.applyControllerState = applyControllerState; this.featuredCamera = () => selectedCameraIdentity;`, context);
  return { context, emitted, renderCount: () => renders };
}

test("controller publishes its featured camera selection", () => {
  const harness = stateHarness({ controller: true });
  harness.context.publishControllerState();

  assert.equal(harness.emitted.length, 1);
  assert.equal(harness.emitted[0][0], "meeting_control");
  assert.equal(harness.emitted[0][1].featuredCameraIdentity, "camera-owner");
  assert.equal(Object.hasOwn(harness.emitted[0][1], "featuredShareIdentity"), false);
});

test("controller only publishes featured share when intentionally changed", () => {
  const harness = stateHarness({ controller: true });
  harness.context.publishControllerState({ featuredShareIdentity: "screen-owner" });

  assert.equal(harness.emitted.length, 1);
  assert.equal(harness.emitted[0][1].featuredShareIdentity, "screen-owner");
});

test("audience applies the controller featured camera selection", () => {
  const harness = stateHarness();
  harness.context.applyControllerState({
    presentationId: "presentation-1",
    featuredCameraIdentity: "audience-camera-2",
    mutedParticipants: []
  });

  assert.equal(harness.context.featuredCamera(), "audience-camera-2");
  assert.equal(harness.renderCount(), 1);
});

test("legacy control updates do not clear a featured camera", () => {
  const harness = stateHarness();
  harness.context.applyControllerState({
    presentationId: "presentation-1",
    mutedParticipants: []
  });

  assert.equal(harness.context.featuredCamera(), "camera-owner");
});

test("audience page includes a featured camera stage", () => {
  const html = fs.readFileSync(path.join(__dirname, "../frontend/present.html"), "utf8");
  assert.match(html, /data-live-featured-camera-viewer/);
  assert.match(html, /data-live-featured-camera-media/);
});

test("controller can feature its own active camera on the main stage", () => {
  assert.match(liveMediaSource, /function createFeatureCameraButton\(participant\)/);
  assert.match(liveMediaSource, /isController && isLocal && videoPublication\?\.track/);
  assert.match(liveMediaSource, /participantActions\.append\(createFeatureCameraButton\(participant\)\)/);
});
