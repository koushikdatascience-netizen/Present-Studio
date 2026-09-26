const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const liveMediaSource = fs.readFileSync(path.join(__dirname, "../frontend/js/live-media.js"), "utf8");
const presentSource = fs.readFileSync(path.join(__dirname, "../frontend/js/present.js"), "utf8");
const apiSource = fs.readFileSync(path.join(__dirname, "../frontend/js/api.js"), "utf8");

function returnStateHarness(value) {
  const values = new Map([["presentStudio.cohostReturnState.presentation-1", value]]);
  const sessionStorage = {
    getItem: key => values.get(key) || null,
    removeItem: key => values.delete(key)
  };
  const start = presentSource.indexOf("function takeCohostReturnState");
  const end = presentSource.indexOf("function setAudienceTheme", start);
  const context = { sessionStorage, JSON };
  vm.runInNewContext(`${presentSource.slice(start, end)}; this.take = takeCohostReturnState;`, context);
  return { context, values };
}

test("co-host return restores and consumes the guest name, meeting code, and automatic rejoin", () => {
  const harness = returnStateHarness(JSON.stringify({ displayName: "  Guest Name  ", screenAccessCode: "8642", autoRejoin: true }));
  const restored = harness.context.take("presentation-1");

  assert.equal(restored.displayName, "Guest Name");
  assert.equal(restored.screenAccessCode, "8642");
  assert.equal(restored.autoRejoin, true);
  assert.equal(harness.values.size, 0);
});

test("invalid co-host return codes are never restored", () => {
  const harness = returnStateHarness(JSON.stringify({ displayName: "Guest", screenAccessCode: "12ab" }));
  assert.equal(harness.context.take("presentation-1").screenAccessCode, "");
});

test("promotion saves return form state and only one frontend owns role updates", () => {
  assert.match(liveMediaSource, /presentStudio\.cohostReturnState/);
  assert.match(liveMediaSource, /displayName:\s*nameInput\.value\.trim\(\)/);
  assert.match(liveMediaSource, /screenAccessCode:\s*\/\^\\d\{4\}\$\//);
  assert.match(liveMediaSource, /autoRejoin:\s*true/);
  assert.match(presentSource, /cohostReturnState\.autoRejoin[\s\S]*joinButton\.click\(\)/);
  assert.equal((liveMediaSource.match(/emit\("meeting_role_update"/g) || []).length, 1);
  assert.doesNotMatch(apiSource, /emit\("meeting_role_update"/);
  assert.doesNotMatch(apiSource, /function roleButton\(/);
});

test("demotion uses a meeting-scoped resume credential and rejoins automatically", () => {
  assert.match(liveMediaSource, /message\.resumeToken/);
  assert.match(liveMediaSource, /searchParams\.set\("resume", resumeToken\)/);
  assert.match(liveMediaSource, /resumeToken: options\.resumeToken/);
  assert.match(presentSource, /const participantResumeToken = params\.get\("resume"\)/);
  assert.match(presentSource, /result\.resumeGuestId/);
  assert.match(presentSource, /localStorage\.setItem\("presentStudio\.meetingGuestId"/);
  assert.match(presentSource, /admissionBypass: presenter \|\| Boolean\(participantResumeToken\)/);
  assert.match(presentSource, /cohostReturnState\.autoRejoin \|\| participantResumeToken/);
  assert.match(apiSource, /resume=\$\{encodeURIComponent\(resumeToken\)\}/);
});
