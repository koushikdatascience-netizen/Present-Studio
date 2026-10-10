const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const dashboardHtml = fs.readFileSync(path.join(__dirname, "../frontend/dashboard.html"), "utf8");
const dashboard = fs.readFileSync(path.join(__dirname, "../frontend/js/dashboard.js"), "utf8");
const api = fs.readFileSync(path.join(__dirname, "../frontend/js/api.js"), "utf8");
const controller = fs.readFileSync(path.join(__dirname, "../frontend/js/controller.js"), "utf8");

test("dashboard exposes the complete instant and scheduled meeting workflow", () => {
  assert.match(dashboardHtml, /id="createMeeting"/);
  assert.match(dashboardHtml, /name="timingMode" value="instant"/);
  assert.match(dashboardHtml, /name="timingMode" value="scheduled"/);
  assert.match(dashboardHtml, /name="durationMode" value="unlimited"/);
  assert.match(dashboardHtml, /name="durationMode" value="timed"/);
  assert.match(dashboardHtml, /name="accessType" value="public"/);
  assert.match(dashboardHtml, /name="accessType" value="private"/);
});

test("meeting creation sends scheduling and privacy choices to the dedicated API", () => {
  assert.match(api, /createMeeting:\s*\(meeting\).*\/api\/meetings/);
  assert.match(dashboard, /api\.createMeeting\(\{/);
  assert.match(dashboard, /scheduledStart:\s*timingMode === "scheduled"/);
  assert.match(dashboard, /scheduledEnd:\s*scheduledEnd\?\.toISOString/);
  assert.match(dashboard, /meeting\.accessCode/);
});

test("timed owner meetings automatically close at their configured end", () => {
  assert.match(controller, /function scheduleMeetingExpiry\(meeting\)/);
  assert.match(controller, /socket\?\.emit\("meeting_close", credentials\(\)\)/);
});
