const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const liveMediaSource = fs.readFileSync(path.join(__dirname, "../frontend/js/live-media.js"), "utf8");
const helperStart = liveMediaSource.indexOf("    function updateAudienceFeedback");
const helperEnd = liveMediaSource.indexOf("    const setStatus", helperStart);
const helperSource = liveMediaSource.slice(helperStart, helperEnd);

function feedbackHarness() {
  const timers = new Map();
  let nextTimer = 1;
  const feedback = { textContent: "", dataset: {} };
  const context = {
    audienceFeedback: feedback,
    audienceFeedbackTimer: 0,
    window: {
      setTimeout(callback) {
        const id = nextTimer++;
        timers.set(id, callback);
        return id;
      },
      clearTimeout(id) { timers.delete(id); }
    }
  };
  vm.runInNewContext(`${helperSource}; this.updateAudienceFeedback = updateAudienceFeedback;`, context);
  return { context, feedback, timers };
}

test("routine success feedback disappears after its timeout", () => {
  const harness = feedbackHarness();
  harness.context.updateAudienceFeedback("Meeting restored after device interruption", "success");

  assert.equal(harness.feedback.textContent, "Meeting restored after device interruption");
  assert.equal(harness.timers.size, 1);
  [...harness.timers.values()][0]();
  assert.equal(harness.feedback.textContent, "");
  assert.equal(harness.feedback.dataset.kind, "");
});

test("a newer error cannot be cleared by an older success timer", () => {
  const harness = feedbackHarness();
  harness.context.updateAudienceFeedback("Connected", "success");
  const oldTimer = [...harness.timers.values()][0];

  harness.context.updateAudienceFeedback("Microphone permission was not granted", "error");
  oldTimer();

  assert.equal(harness.feedback.textContent, "Microphone permission was not granted");
  assert.equal(harness.feedback.dataset.kind, "error");
});
