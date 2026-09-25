const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const liveMediaSource = fs.readFileSync(path.join(__dirname, "../frontend/js/live-media.js"), "utf8");
const helperStart = liveMediaSource.indexOf("    function stopAdmissionAlarm");
const helperEnd = liveMediaSource.indexOf("    function renderLobby", helperStart);
const helperSource = liveMediaSource.slice(helperStart, helperEnd);

function alarmHarness() {
  const timers = new Map();
  let nextTimer = 1;
  let pulses = 0;
  const context = {
    admissionAlarmActive: false,
    admissionAlarmTimer: 0,
    admissionAlarmPulseInFlight: false,
    isController: true,
    soundContext: null,
    window: {
      AudioContext: function AudioContext() {
        return {
          currentTime: 0,
          destination: {},
          resume: async () => {},
          createOscillator: () => ({
            type: "",
            frequency: { setValueAtTime() {} },
            connect() {},
            start() { pulses += 1; },
            stop() {}
          }),
          createGain: () => ({
            gain: {
              setValueAtTime() {},
              exponentialRampToValueAtTime() {}
            },
            connect() {}
          })
        };
      },
      setInterval(callback) {
        const id = nextTimer++;
        timers.set(id, callback);
        return id;
      },
      clearInterval(id) { timers.delete(id); }
    }
  };
  vm.runInNewContext(`${helperSource}; this.syncAdmissionAlarm = syncAdmissionAlarm;`, context);
  return { context, timers, pulseCount: () => pulses };
}

test("admission alarm repeats while audience requests are pending", async () => {
  const harness = alarmHarness();
  harness.context.syncAdmissionAlarm(1);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(harness.timers.size, 1);
  assert.equal(harness.pulseCount(), 3);

  const repeat = [...harness.timers.values()][0];
  repeat();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(harness.pulseCount(), 6);
});

test("admission alarm stops when every request is handled", async () => {
  const harness = alarmHarness();
  harness.context.syncAdmissionAlarm(2);
  await new Promise(resolve => setImmediate(resolve));
  harness.context.syncAdmissionAlarm(0);

  assert.equal(harness.timers.size, 0);
  assert.equal(harness.context.admissionAlarmActive, false);
  assert.equal(harness.context.admissionAlarmTimer, 0);
});
