const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const dashboardHtml = fs.readFileSync(path.join(__dirname, "../frontend/dashboard.html"), "utf8");
const dashboard = fs.readFileSync(path.join(__dirname, "../frontend/js/dashboard.js"), "utf8");
const api = fs.readFileSync(path.join(__dirname, "../frontend/js/api.js"), "utf8");
const controller = fs.readFileSync(path.join(__dirname, "../frontend/js/controller.js"), "utf8");
const dashboardStyles = fs.readFileSync(path.join(__dirname, "../frontend/css/dashboard.css"), "utf8");
const controllerStyles = fs.readFileSync(path.join(__dirname, "../frontend/css/styles.css"), "utf8");

test("dashboard exposes the complete instant and scheduled meeting workflow", () => {
  assert.match(dashboardHtml, /id="createMeeting"/);
  assert.match(dashboardHtml, /id="meetingRoomMedia"[^>]+accept="image\/\*,video\/\*"/);
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
  assert.match(dashboard, /attachRoomMediaToMeeting\(meeting, roomMediaFile, youtubeId\)/);
  assert.match(dashboard, /api\.uploadMedia\(file\)/);
  assert.match(dashboard, /api\.savePresentation\(updated\)/);
  assert.match(dashboard, /scheduledStart:\s*timingMode === "scheduled"/);
  assert.match(dashboard, /scheduledEnd:\s*scheduledEnd\?\.toISOString/);
  assert.match(dashboard, /meeting\.accessCode/);
});

test("timed owner meetings automatically close at their configured end", () => {
  assert.match(controller, /function scheduleMeetingExpiry\(meeting\)/);
  assert.match(controller, /socket\?\.emit\("meeting_close", credentials\(\)\)/);
  assert.match(controller, /meeting_time_extended/);
  const liveMedia = fs.readFileSync(path.join(__dirname, "../frontend/js/live-media.js"), "utf8");
  assert.match(liveMedia, /5 \* 60 \* 1000/);
  assert.match(liveMedia, /meeting-time-extension-button/);
  assert.match(liveMedia, /api\.extendMeeting/);
});

test("controller slide cards render legacy images in compact 16:9 thumbnails", () => {
  assert.match(controller, /fabric\.Image\.fromURL\(item\.src/);
  assert.match(controller, /data\.elements \|\| \[\]/);
  assert.match(controllerStyles, /controller-target-thumb \.canvas-container \{[^}]*width: 100% !important; height: 100% !important/);
  assert.match(controllerStyles, /controller-library-panel \.controller-target-thumb \{[^}]*aspect-ratio: 16 \/ 9/);
});

test("dashboard presents meetings as a responsive grid with confirmed deletion", () => {
  assert.match(dashboardHtml, /id="createMeeting"/);
  assert.match(dashboardHtml, /data-create-meeting-link/);
  assert.match(dashboardStyles, /\.dashboard-content\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 400px/);
  assert.match(dashboardStyles, /\.meeting-grid\s*\{[^}]*grid-template-columns:\s*1fr/);
  assert.match(dashboardStyles, /@media \(max-width:\s*900px\)[\s\S]*\.dashboard-content\s*\{\s*grid-template-columns:\s*1fr/);
  assert.match(api, /deleteMeeting:\s*\(id\).*method:\s*"DELETE"/);
  assert.match(dashboard, /data-delete-meeting/);
  assert.match(dashboard, /window\.confirm\([\s\S]*The audience link will stop working immediately/);
  assert.match(dashboard, /await api\.deleteMeeting\(meeting\.id\)/);
});

test("meeting setup uses compact yellow actions instead of black buttons", () => {
  assert.match(dashboardStyles, /\.meeting-create-dialog\s*\{[^}]*width:\s*min\(650px/);
  assert.match(dashboardStyles, /\.cta-primary\s*\{\s*background:\s*var\(--yellow-strong\)/);
  assert.match(dashboardStyles, /\.cta-secondary\s*\{\s*background:\s*#fff8d7/);
  assert.match(dashboardStyles, /\.meeting-card-actions a\s*\{[^}]*background:\s*var\(--yellow-strong\)/);
  assert.doesNotMatch(dashboardStyles, /\.cta-primary\s*\{[^}]*background:\s*#101010/);
});
