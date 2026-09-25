const api = window.PresentStudioApi;
const grid = document.querySelector("#presentationGrid");
const createButton = document.querySelector("#createPresentation");
const createMeetingButton = document.querySelector("#createMeeting");
const meetingGrid = document.querySelector("#meetingGrid");
const meetingDialog = document.querySelector("#meetingCreateDialog");
const meetingForm = document.querySelector("#meetingCreateForm");
const toast = document.querySelector("#toast");
const profileButton = document.querySelector("#profileButton");
const builderButtons = [document.querySelector("#builderNav"), document.querySelector("#openBuilder")].filter(Boolean);
const searchInput = document.querySelector("#presentationSearch");

let toastTimer = null;
let dashboardPresentations = [];
let dashboardMeetings = [];
function showToast(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2600);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>\"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;"
  })[character]);
}

function getAccent(deck, index) {
  const explicit = String(deck.accent || "").toLowerCase();
  if (["warm", "cream", "dark", "soft"].includes(explicit)) return explicit;
  return ["warm", "cream", "dark", "soft"][index % 4];
}

function updateDashboardStats(presentations) {
  document.querySelector("#presentationCount").textContent = String(presentations.length).padStart(2, "0");
  document.querySelector("#recentCount").textContent = String(presentations.filter(deck => deck.updatedAt && Date.now() - new Date(deck.updatedAt).getTime() < 30 * 86400000).length).padStart(2, "0");
  document.querySelector("#slideTotal").textContent = String(presentations.reduce((total, deck) => total + (deck.slides?.length || 0), 0)).padStart(2, "0");
}

function filteredPresentations() {
  const query = searchInput?.value.trim().toLowerCase() || "";
  return dashboardPresentations.filter(deck => String(deck.title || "").toLowerCase().includes(query));
}

function renderDecks(presentations) {
  if (!grid) return;
  if (!presentations.length) {
    grid.innerHTML = `<p class="dashboard-status">No presentations yet. Use “New Presentation” to start your first deck.</p>`;
    return;
  }

  grid.innerHTML = presentations.map((deck, index) => {
    const title = escapeHtml(deck.title || "Untitled presentation");
    const slides = Array.isArray(deck.slides) ? deck.slides.length : 0;
    const slideLabel = `${slides} slide${slides === 1 ? "" : "s"}`;
    const updated = deck.updatedAt ? new Date(deck.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "Draft";
    const accent = getAccent(deck, index);
    return `
      <article class="presentation-card">
        <button class="presentation-preview" data-accent="${accent}" type="button" data-open="${escapeHtml(deck.id)}" aria-label="Open ${title}">
          <span class="preview-kicker">PRESENT STUDIO</span>
          <span class="preview-number">${String(index + 1).padStart(2, "0")}</span>
          <span class="preview-title">${title}</span>
        </button>
        <div class="presentation-card-footer">
          <button type="button" class="card-delete" data-delete="${escapeHtml(deck.id)}" aria-label="Delete ${title}" title="Delete presentation"><i class="bi bi-trash"></i></button>
          <div><h3>${title}</h3><p>${slideLabel} · ${escapeHtml(updated)}</p></div>
          <button type="button" class="card-menu" data-toast="Presentation options will connect to the backend.">•••</button>
        </div>
      </article>
    `;
  }).join("");

  grid.querySelectorAll("[data-open]").forEach((button) => {
    button.addEventListener("click", () => {
      window.location.href = `/builder.html?id=${encodeURIComponent(button.dataset.open)}`;
    });
  });
  grid.querySelectorAll("[data-toast]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      showToast(button.dataset.toast);
    });
  });
  grid.querySelectorAll("[data-delete]").forEach(button => button.addEventListener("click", async event => {
    event.stopPropagation();
    const deck = dashboardPresentations.find(item => item.id === button.dataset.delete);
    if (!deck || !window.confirm(`Delete “${deck.title || "Untitled presentation"}”? This cannot be undone.`)) return;
    button.disabled = true;
    try {
      await api.deletePresentation(deck.id);
      dashboardPresentations = dashboardPresentations.filter(item => item.id !== deck.id);
      updateDashboardStats(dashboardPresentations);
      renderDecks(filteredPresentations());
      showToast("Presentation deleted.");
    } catch (error) {
      button.disabled = false;
      showToast(error.message);
    }
  }));
}

function meetingStatusLabel(meeting) {
  if (meeting.status === "closed") return "Closed";
  if (meeting.status === "ended") return "Ended";
  if (meeting.status === "scheduled") return "Scheduled";
  return meeting.timingMode === "instant" ? "Ready now" : "Ready to start";
}

function meetingTimeLabel(meeting) {
  const start = new Date(meeting.scheduledStart);
  const startLabel = meeting.timingMode === "instant" ? "Instant meeting" : start.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  if (!meeting.scheduledEnd) return `${startLabel} · Unlimited`;
  return `${startLabel} – ${new Date(meeting.scheduledEnd).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`;
}

async function copyText(value, successMessage) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const input = document.createElement("textarea");
    input.value = value;
    document.body.append(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }
  showToast(successMessage);
}

function renderMeetings(meetings) {
  if (!meetingGrid) return;
  if (!meetings.length) {
    meetingGrid.innerHTML = `<p class="dashboard-status">No meetings yet. Create an instant room or schedule one for later.</p>`;
    return;
  }
  meetingGrid.innerHTML = meetings.map(meeting => {
    const ended = ["closed", "ended"].includes(meeting.status);
    return `<article class="meeting-card ${ended ? "is-ended" : ""}">
      <div class="meeting-card-icon"><i class="bi bi-camera-video"></i></div>
      <div class="meeting-card-content"><div><span class="meeting-status">${escapeHtml(meetingStatusLabel(meeting))}</span><span class="meeting-privacy"><i class="bi ${meeting.accessType === "private" ? "bi-lock" : "bi-globe2"}"></i>${escapeHtml(meeting.accessType)}</span></div><h3>${escapeHtml(meeting.title)}</h3><p>${escapeHtml(meetingTimeLabel(meeting))}</p></div>
      <div class="meeting-card-actions"><button type="button" data-copy-audience="${escapeHtml(meeting.audienceUrl)}" ${ended ? "disabled" : ""}><i class="bi bi-link-45deg"></i><span>Copy link</span></button><a href="${escapeHtml(meeting.controllerUrl)}" ${ended ? 'aria-disabled="true" tabindex="-1"' : ""}><i class="bi bi-box-arrow-up-right"></i><span>Owner controls</span></a></div>
    </article>`;
  }).join("");
  meetingGrid.querySelectorAll("[data-copy-audience]").forEach(button => button.addEventListener("click", () => copyText(button.dataset.copyAudience, "Audience link copied.")));
}

async function loadDashboard() {
  if (!grid) return;
  grid.innerHTML = `<p class="dashboard-status">Loading your presentations…</p>`;
  const [{ presentations }, { meetings }] = await Promise.all([api.listPresentations(), api.listMeetings()]);
  dashboardPresentations = presentations.filter(item => item.status !== "meeting");
  dashboardMeetings = meetings;
  updateDashboardStats(dashboardPresentations);
  renderDecks(dashboardPresentations);
  renderMeetings(meetings);
}

function localDateTimeValue(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function resetMeetingDialog() {
  meetingForm?.reset();
  const now = new Date();
  const start = new Date(now.getTime() + 30 * 60000);
  start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15, 0, 0);
  const end = new Date(start.getTime() + 60 * 60000);
  document.querySelector("#meetingTitle").value = "New meeting";
  document.querySelector("#meetingScheduledStart").value = localDateTimeValue(start);
  document.querySelector("#meetingScheduledEnd").value = localDateTimeValue(end);
  document.querySelector("[data-meeting-form]").hidden = false;
  document.querySelector("[data-meeting-result]").hidden = true;
  document.querySelector("#meetingSubmit").hidden = false;
  document.querySelector("#meetingCancel").textContent = "Cancel";
  document.querySelector("#meetingOwnerJoin").hidden = true;
  document.querySelector("#meetingFormError").hidden = true;
  syncMeetingFields();
}

function syncMeetingFields() {
  const timing = meetingForm?.elements.timingMode?.value || "instant";
  const duration = meetingForm?.elements.durationMode?.value || "unlimited";
  const startField = document.querySelector("[data-scheduled-start]");
  const endField = document.querySelector("[data-scheduled-end]");
  startField.hidden = timing !== "scheduled";
  endField.hidden = duration !== "timed";
  startField.querySelector("input").required = timing === "scheduled";
  endField.querySelector("input").required = duration === "timed";
}

function closeMeetingDialog() {
  meetingDialog?.close();
}

createMeetingButton?.addEventListener("click", () => {
  resetMeetingDialog();
  meetingDialog.showModal();
});
meetingForm?.addEventListener("change", syncMeetingFields);
document.querySelector("#meetingDialogClose")?.addEventListener("click", closeMeetingDialog);
document.querySelector("#meetingCancel")?.addEventListener("click", closeMeetingDialog);
meetingDialog?.addEventListener("click", event => { if (event.target === meetingDialog) closeMeetingDialog(); });
meetingForm?.addEventListener("submit", async event => {
  event.preventDefault();
  const submit = document.querySelector("#meetingSubmit");
  const error = document.querySelector("#meetingFormError");
  const timingMode = meetingForm.elements.timingMode.value;
  const durationMode = meetingForm.elements.durationMode.value;
  const startInput = document.querySelector("#meetingScheduledStart").value;
  const endInput = document.querySelector("#meetingScheduledEnd").value;
  const scheduledStart = timingMode === "scheduled" ? new Date(startInput) : new Date();
  const scheduledEnd = durationMode === "timed" ? new Date(endInput) : null;
  if (timingMode === "scheduled" && (!startInput || scheduledStart <= new Date())) {
    error.textContent = "Choose a future start date and time.";
    error.hidden = false;
    return;
  }
  if (durationMode === "timed" && (!endInput || scheduledEnd <= scheduledStart)) {
    error.textContent = "The end date and time must be after the meeting starts.";
    error.hidden = false;
    return;
  }
  error.hidden = true;
  submit.disabled = true;
  try {
    const meeting = await api.createMeeting({
      title: document.querySelector("#meetingTitle").value.trim() || "New meeting",
      timingMode,
      durationMode,
      accessType: meetingForm.elements.accessType.value,
      scheduledStart: timingMode === "scheduled" ? scheduledStart.toISOString() : null,
      scheduledEnd: scheduledEnd?.toISOString() || null
    });
    document.querySelector("[data-meeting-form]").hidden = true;
    document.querySelector("[data-meeting-result]").hidden = false;
    document.querySelector("#meetingSubmit").hidden = true;
    document.querySelector("#meetingCancel").textContent = "Done";
    document.querySelector("#meetingResultSummary").textContent = `${meetingStatusLabel(meeting)} · ${meeting.accessType === "private" ? "Private access" : "Public access"}`;
    document.querySelector("#meetingAudienceLink").value = meeting.audienceUrl;
    const codePanel = document.querySelector("[data-meeting-access-code]");
    codePanel.hidden = !meeting.accessCode;
    document.querySelector("#meetingAccessCode").textContent = meeting.accessCode || "";
    const ownerJoin = document.querySelector("#meetingOwnerJoin");
    ownerJoin.href = meeting.controllerUrl;
    ownerJoin.hidden = false;
    dashboardMeetings = [meeting, ...dashboardMeetings];
    renderMeetings(dashboardMeetings);
  } catch (creationError) {
    error.textContent = creationError.message;
    error.hidden = false;
  } finally {
    submit.disabled = false;
  }
});
document.querySelector("[data-copy-meeting-link]")?.addEventListener("click", () => copyText(document.querySelector("#meetingAudienceLink").value, "Audience link copied."));
document.querySelector("[data-copy-meeting-code]")?.addEventListener("click", () => copyText(document.querySelector("#meetingAccessCode").textContent, "Meeting code copied."));

async function openBuilder() {
  const existing = dashboardPresentations[0];
  if (existing) {
    window.location.href = `/builder.html?id=${encodeURIComponent(existing.id)}`;
    return;
  }
  builderButtons.forEach(button => { button.disabled = true; });
  try {
    const { presentation } = await api.createPresentation("Untitled presentation");
    window.location.href = `/builder.html?id=${encodeURIComponent(presentation.id)}`;
  } catch (error) {
    builderButtons.forEach(button => { button.disabled = false; });
    showToast(error.message);
  }
}

builderButtons.forEach(button => button.addEventListener("click", openBuilder));

createButton?.addEventListener("click", async () => {
  createButton.disabled = true;
  try {
    const { presentation } = await api.createPresentation("Untitled presentation");
    window.location.href = `/builder.html?id=${encodeURIComponent(presentation.id)}`;
  } catch (error) {
    createButton.disabled = false;
    showToast(error.message);
  }
});

profileButton?.addEventListener("click", async () => {
  const confirmed = window.confirm("Sign out of Present Studio?");
  if (!confirmed) return;
  try { await api.logout(); } catch (error) { /* Continue to login even if logout request fails. */ }
  window.location.href = "/login.html";
});

document.querySelectorAll("[data-toast]").forEach((element) => {
  element.addEventListener("click", () => showToast(element.dataset.toast));
});

searchInput?.addEventListener("input", () => {
  renderDecks(filteredPresentations());
});

document.querySelectorAll("[data-view]").forEach(button => button.addEventListener("click", () => {
  document.querySelectorAll("[data-view]").forEach(item => item.classList.toggle("is-active", item === button));
  grid.classList.toggle("is-list", button.dataset.view === "list");
}));

const session = api.getCachedSession();
if (session) {
  const firstName = String(session.name || "Presenter").trim().split(/\s+/)[0];
  const hour = new Date().getHours();
  document.querySelector("#dashboardGreeting").textContent = `${hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"}, ${firstName}.`;
  document.querySelector("#profileInitials").textContent = String(session.name || "PS").split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase();
  const adminNav = document.querySelector("#adminNav");
  if (adminNav && session.role === "admin") adminNav.hidden = false;
}
document.querySelector("#dashboardDate").textContent = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date()).toUpperCase();

if (!api.getCachedSession()) {
  window.location.replace("/login.html");
} else loadDashboard().catch((error) => {
  if (/authentication required|not authenticated|invalid token/i.test(error.message || "")) {
    window.location.replace("/login.html");
    return;
  }
  if (grid) grid.innerHTML = `<p class="dashboard-status error">${escapeHtml(error.message)}</p>`;
});
