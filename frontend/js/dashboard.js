const api = window.PresentStudioApi;
const grid = document.querySelector("#presentationGrid");
const createButton = document.querySelector("#createPresentation");
const createMeetingButton = document.querySelector("#createMeeting");
const createMeetingLinks = [createMeetingButton, ...document.querySelectorAll("[data-create-meeting-link]")].filter(Boolean);
const meetingGrid = document.querySelector("#meetingGrid");
const meetingDialog = document.querySelector("#meetingCreateDialog");
const privateMeetingDialog = document.querySelector("#privateMeetingDialog");
const meetingForm = document.querySelector("#meetingCreateForm");
const toast = document.querySelector("#toast");
const presentationShareDialog = document.querySelector("#presentationShareDialog");
const profileButton = document.querySelector("#profileButton");
const builderButtons = [document.querySelector("#builderNav"), document.querySelector("#openBuilder")].filter(Boolean);
const searchInput = document.querySelector("#presentationSearch");
const meetingRoomMediaInput = document.querySelector("#meetingRoomMedia");
const meetingRoomMediaName = document.querySelector("[data-meeting-media-name]");

let toastTimer = null;
let dashboardPresentations = [];
let dashboardMeetings = [];
let privateMeetingNoticeSeen = false;
let dashboardThumbnailCanvases = [];
let activeSharePresentationId = "";

function renderDashboardThumbnails(presentations) {
  if (!window.fabric) return;
  grid.querySelectorAll('[data-deck-thumbnail]').forEach(element => {
    const deck = presentations.find(item => item.id === element.dataset.deckThumbnail);
    const data = deck?.slides?.[0]?.canvas || {};
    const thumbnail = new fabric.StaticCanvas(element, { width: 1280, height: 720, renderOnAddRemove: false });
    const objectOrder = new WeakMap();
    dashboardThumbnailCanvases.push(thumbnail);
    const render = () => {
      if (!dashboardThumbnailCanvases.includes(thumbnail)) return;
      if (!data.fabric) thumbnail.getObjects().slice().sort((a, b) => objectOrder.get(a) - objectOrder.get(b)).forEach((object, index) => thumbnail.moveTo(object, index));
      thumbnail.backgroundColor = data.background || '#fff';
      thumbnail.renderAll();
    };
    const media = [];
    if (data.fabric) {
      const scene = JSON.parse(JSON.stringify(data.fabric));
      media.push(...(scene.objects || []).filter(object => ['video', 'youtube'].includes(object.mediaType)));
      scene.objects = (scene.objects || []).filter(object => !['video', 'youtube', 'audio', 'screen-share'].includes(object.mediaType));
      thumbnail.loadFromJSON(scene, render);
    } else {
      (data.elements || []).forEach((object, index) => {
        if (object.type === 'image' && object.src) {
          fabric.Image.fromURL(object.src, image => {
            if (!image || !dashboardThumbnailCanvases.includes(thumbnail)) return;
            const width = Number(object.width || 100) * 12.8;
            const height = Number(object.height || 100) * 7.2;
            const scale = object.fit === 'contain' ? Math.min(width / image.width, height / image.height) : null;
            image.set({ left: Number(object.x || 0) * 12.8 + (scale ? (width - image.width * scale) / 2 : 0), top: Number(object.y || 0) * 7.2 + (scale ? (height - image.height * scale) / 2 : 0), scaleX: scale || width / image.width, scaleY: scale || height / image.height, selectable: false });
            objectOrder.set(image, index);
            thumbnail.add(image);
            render();
          });
        } else if (['text', 'textbox'].includes(object.type)) {
          const text = new fabric.Textbox(object.text || '', { left: Number(object.x || 0) * 12.8, top: Number(object.y || 0) * 7.2, width: Number(object.width || 80) * 12.8, fontSize: Number(object.fontSize || 32), fill: object.color || '#171717', fontFamily: object.fontFamily || 'Arial', textAlign: object.textAlign || 'left' });
          objectOrder.set(text, index);
          thumbnail.add(text);
        } else if (['video', 'youtube'].includes(object.type)) media.push({ ...object, legacy: true });
      });
      render();
    }
    media.forEach(object => {
      const youtubeId = window.SnapKeyYouTube?.idFor(object);
      const node = document.createElement(youtubeId || object.poster ? 'img' : 'video');
      node.className = 'dashboard-slide-media';
      if (node.tagName === 'IMG') { node.src = youtubeId ? `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg` : object.poster; node.alt = ''; }
      else { node.src = object.src || ''; node.muted = true; node.preload = 'metadata'; node.playsInline = true; node.addEventListener('loadedmetadata', () => { try { node.currentTime = Math.min(0.1, node.duration / 2); } catch {} }, { once: true }); }
      const legacy = object.legacy;
      Object.assign(node.style, { left: `${legacy ? Number(object.x || 0) : Number(object.left || 0) / 12.8}%`, top: `${legacy ? Number(object.y || 0) : Number(object.top || 0) / 7.2}%`, width: `${legacy ? Number(object.width || 100) : Number(object.width || 1280) * Number(object.scaleX || 1) / 12.8}%`, height: `${legacy ? Number(object.height || 100) : Number(object.height || 720) * Number(object.scaleY || 1) / 7.2}%`, objectFit: object.fit === 'contain' ? 'contain' : 'cover' });
      element.parentElement.append(node);
    });
  });
}
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
  const recentDeck = presentations.find(deck => deck.updatedAt);
  document.querySelector("#recentCount").textContent = recentDeck?.updatedAt
    ? new Date(recentDeck.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : "Draft";
  document.querySelector("#slideTotal").textContent = String(presentations.reduce((total, deck) => total + (deck.slides?.length || 0), 0)).padStart(2, "0");
}

function filteredPresentations() {
  const query = searchInput?.value.trim().toLowerCase() || "";
  return dashboardPresentations.filter(deck => String(deck.title || "").toLowerCase().includes(query));
}

function renderDecks(presentations) {
  if (!grid) return;
  dashboardThumbnailCanvases.forEach(canvas => canvas.dispose());
  dashboardThumbnailCanvases = [];
  const createTile = `
    <button class="presentation-create-card" type="button" data-create-presentation-card>
      <span><i class="bi bi-plus-lg" aria-hidden="true"></i></span>
      <strong>Create new presentation</strong>
    </button>
  `;
  if (!presentations.length) {
    grid.innerHTML = createTile;
    grid.querySelector("[data-create-presentation-card]")?.addEventListener("click", () => createButton?.click());
    return;
  }

  grid.innerHTML = presentations.map((deck, index) => {
    const title = escapeHtml(deck.title || "Untitled presentation");
    const slides = Array.isArray(deck.slides) ? deck.slides.length : 0;
    const slideLabel = `${slides} slide${slides === 1 ? "" : "s"}`;
    const updated = deck.updatedAt ? new Date(deck.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "Draft";
    const accent = getAccent(deck, index);
    const firstCanvas = deck.slides?.[0]?.canvas;
    const hasPreview = Boolean(firstCanvas && ((firstCanvas.fabric?.objects || []).length || (firstCanvas.elements || []).length || firstCanvas.background));
    return `
      <article class="presentation-card">
        <button class="presentation-preview${hasPreview ? ' has-slide-preview' : ''}" data-accent="${accent}" type="button" data-open="${escapeHtml(deck.id)}" aria-label="Open ${title}">
          ${hasPreview ? `<span class="dashboard-slide-thumbnail"><canvas data-deck-thumbnail="${escapeHtml(deck.id)}" aria-label="First slide preview"></canvas></span>` : `<span class="preview-kicker">PRESENT STUDIO</span>
          <span class="preview-number">${String(index + 1).padStart(2, "0")}</span>
          <span class="preview-title">${title}</span>`}
        </button>
        <div class="presentation-card-footer">
          <div class="presentation-card-copy"><h3>${title}</h3><p>${slideLabel} · ${escapeHtml(updated)}</p></div>
          <div class="presentation-card-actions">
            <button type="button" class="presentation-card-action" data-share-presentation="${escapeHtml(deck.id)}" aria-label="Share read-only presentation link" title="Share read-only link"><i class="bi bi-link-45deg" aria-hidden="true"></i></button>
            <button type="button" class="presentation-card-action" data-download-presentation="${escapeHtml(deck.id)}" aria-label="Download HTML presentation" title="Download HTML presentation"><i class="bi bi-download" aria-hidden="true"></i></button>
            <div class="presentation-options">
              <button type="button" class="card-menu" data-menu-toggle="${escapeHtml(deck.id)}" aria-label="More presentation actions" aria-expanded="false" title="More actions"><i class="bi bi-three-dots-vertical" aria-hidden="true"></i></button>
              <div class="presentation-options-menu" data-deck-menu="${escapeHtml(deck.id)}" hidden>
                <button type="button" data-delete="${escapeHtml(deck.id)}"><i class="bi bi-trash" aria-hidden="true"></i><span>Delete presentation</span></button>
              </div>
            </div>
          </div>
        </div>
      </article>
    `;
  }).join("") + createTile;
  renderDashboardThumbnails(presentations);

  grid.querySelector("[data-create-presentation-card]")?.addEventListener("click", () => createButton?.click());
  grid.querySelectorAll("[data-open]").forEach((button) => {
    button.addEventListener("click", () => {
      window.location.href = `/builder.html?id=${encodeURIComponent(button.dataset.open)}`;
    });
  });
  grid.querySelectorAll("[data-menu-toggle]").forEach(button => button.addEventListener("click", event => {
    event.stopPropagation();
    const menu = grid.querySelector(`[data-deck-menu="${CSS.escape(button.dataset.menuToggle)}"]`);
    const willOpen = menu.hidden;
    grid.querySelectorAll("[data-deck-menu]").forEach(item => { item.hidden = true; });
    grid.querySelectorAll("[data-menu-toggle]").forEach(item => item.setAttribute("aria-expanded", "false"));
    menu.hidden = !willOpen;
    button.setAttribute("aria-expanded", String(willOpen));
  }));
  grid.querySelectorAll("[data-share-presentation]").forEach(button => button.addEventListener("click", event => {
    event.stopPropagation();
    openPresentationShare(button.dataset.sharePresentation);
  }));
  grid.querySelectorAll("[data-download-presentation]").forEach(button => button.addEventListener("click", event => {
    event.stopPropagation();
    downloadPresentation(button.dataset.downloadPresentation, button);
  }));
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

function viewerShareExpiryLabel(expiresAt) {
  if (!expiresAt) return "This link does not expire.";
  const date = new Date(expiresAt);
  return `Expires ${date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}.`;
}

function displayViewerShare(link) {
  document.querySelector("[data-viewer-share-create]").hidden = Boolean(link);
  document.querySelector("[data-viewer-share-result]").hidden = !link;
  document.querySelector("[data-viewer-share-status]").textContent = link ? "" : "Create a secure, read-only viewer link for this presentation.";
  if (!link) return;
  document.querySelector("#viewerShareUrl").value = link.url;
  document.querySelector("[data-viewer-share-expiry]").textContent = viewerShareExpiryLabel(link.expiresAt);
}

async function openPresentationShare(presentationId) {
  if (!presentationShareDialog) return;
  activeSharePresentationId = presentationId;
  document.querySelector("[data-viewer-share-status]").textContent = "Loading link status…";
  document.querySelector("[data-viewer-share-create]").hidden = true;
  document.querySelector("[data-viewer-share-result]").hidden = true;
  presentationShareDialog.showModal();
  try {
    displayViewerShare(await api.getViewerShareLink(presentationId));
  } catch (error) {
    document.querySelector("[data-viewer-share-status]").textContent = error.message || "Could not load sharing settings.";
  }
}

async function createViewerShare(replace = false) {
  const button = document.querySelector(replace ? "[data-viewer-share-regenerate]" : "[data-viewer-share-generate]");
  const status = document.querySelector("[data-viewer-share-status]");
  if (!activeSharePresentationId || !button) return;
  button.disabled = true;
  status.textContent = "Creating your read-only link…";
  try {
    const raw = document.querySelector("#viewerShareExpiry").value;
    const link = await api.createViewerShareLink(activeSharePresentationId, raw ? Number(raw) : null);
    displayViewerShare(link);
    showToast(replace ? "Read-only link replaced." : "Read-only link created.");
  } catch (error) {
    status.textContent = error.message || "Could not create the share link.";
  } finally {
    button.disabled = false;
  }
}

async function downloadPresentation(presentationId, button) {
  const deck = dashboardPresentations.find(item => item.id === presentationId);
  if (!deck || !button) return;
  button.disabled = true;
  try {
    const [{ presentation }, cssResponse, jsResponse, fabricPatchResponse, fabricResponse] = await Promise.all([
      api.getPresentation(presentationId),
      fetch("/css/viewer.css?v=20261007-viewer"),
      fetch("/js/viewer.js?v=20261007-viewer"),
      fetch("/js/fabric-patch.js?v=20260908-paragraph-align"),
      fetch("https://cdn.jsdelivr.net/npm/fabric@5.3.0/dist/fabric.min.js")
    ]);
    if (!cssResponse.ok || !jsResponse.ok || !fabricPatchResponse.ok || !fabricResponse.ok) throw new Error("Could not prepare the presentation download.");
    const [css, script, fabricPatch, fabricScript] = await Promise.all([cssResponse.text(), jsResponse.text(), fabricPatchResponse.text(), fabricResponse.text()]);
    const portable = JSON.parse(JSON.stringify(presentation));
    const makeMediaAbsolute = value => {
      if (Array.isArray(value)) return value.forEach(makeMediaAbsolute);
      if (!value || typeof value !== "object") return;
      for (const [key, item] of Object.entries(value)) {
        if ((key === "src" || key === "poster") && typeof item === "string" && item.startsWith("/")) value[key] = new URL(item, location.origin).href;
        else makeMediaAbsolute(item);
      }
    };
    makeMediaAbsolute(portable);
    const safeJson = JSON.stringify(portable).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
    const safeScript = script.replace(/<\/script/gi, "<\\/script");
    const safeFabricPatch = fabricPatch.replace(/<\/script/gi, "<\\/script");
    const safeFabricScript = fabricScript.replace(/<\/script/gi, "<\\/script");
    const safeTitle = escapeHtml(portable.title || "SnapKey presentation");
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="A presentation created with SnapKey Studio."><title>${safeTitle}</title><style>${css}</style></head><body class="share-viewer-page"><main class="share-viewer" aria-label="Shared presentation"><section class="share-viewer-stage" id="viewerStage" aria-label="Presentation slide"><div class="share-viewer-media" id="viewerMedia"></div><canvas id="viewerCanvas" width="1280" height="720" aria-label="Presentation content"></canvas><div class="share-viewer-message" id="viewerMessage" role="status">Loading presentation…</div></section><nav class="share-viewer-controls" id="viewerControls" aria-label="Presentation controls" hidden><button type="button" id="viewerPrevious" aria-label="Previous slide" title="Previous slide">‹</button><span class="share-viewer-counter" id="viewerCounter" aria-live="polite">1 / 1</span><button type="button" id="viewerNext" aria-label="Next slide" title="Next slide">›</button><span class="share-viewer-divider" aria-hidden="true"></span><button type="button" id="viewerAutoplay" aria-pressed="false"><span aria-hidden="true">▶</span><span>Autoplay</span></button></nav><footer class="share-viewer-brand"><span class="share-viewer-mark" aria-hidden="true">S</span><span>Presented with SnapKey Studio</span></footer></main><script>${safeFabricScript}</script><script>${safeFabricPatch}</script><script>window.SnapKeyPresentationExport=${safeJson};</script><script>${safeScript}</script></body></html>`;
    const blobUrl = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = blobUrl;
    anchor.download = `${String(portable.title || "presentation").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").trim() || "presentation"}.html`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
    showToast("HTML presentation downloaded. Linked media and YouTube require internet access.");
  } catch (error) {
    showToast(error.message || "Could not download this presentation.");
  } finally {
    button.disabled = false;
  }
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
      <div class="meeting-card-actions"><button type="button" data-copy-audience="${escapeHtml(meeting.audienceUrl)}" ${ended ? "disabled" : ""}><i class="bi bi-link-45deg"></i><span>Copy link</span></button><a href="${escapeHtml(meeting.controllerUrl)}" ${ended ? 'aria-disabled="true" tabindex="-1"' : ""}><i class="bi bi-box-arrow-up-right"></i><span>Owner controls</span></a><button type="button" data-delete-meeting="${escapeHtml(meeting.id)}" aria-label="Delete ${escapeHtml(meeting.title || "meeting")}" title="Delete meeting"><i class="bi bi-trash"></i><span>Delete</span></button></div>
    </article>`;
  }).join("");
  meetingGrid.querySelectorAll("[data-copy-audience]").forEach(button => button.addEventListener("click", () => copyText(button.dataset.copyAudience, "Audience link copied.")));

  meetingGrid.querySelectorAll("[data-delete-meeting]").forEach(button => {
    button.addEventListener("click", async () => {
      const meeting = dashboardMeetings.find(
        item => item.id === button.dataset.deleteMeeting
      );

      if (!meeting) return;

      if (!window.confirm(
        `Delete “${meeting.title || "Meeting"}”? The audience link will stop working immediately.`
      )) return;

      button.disabled = true;

      try {
        await api.deleteMeeting(meeting.id);

        dashboardMeetings = dashboardMeetings.filter(
          item => item.id !== meeting.id
        );

        renderMeetings(dashboardMeetings);
        showToast("Meeting deleted.");
      } catch (error) {
        button.disabled = false;
        showToast(error.message || "Could not delete meeting.");
      }
    });
  });
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

function readLocalDateTime(selector) {
  const value = document.querySelector(selector)?.value || "";
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function meetingMediaElement(asset) {
  const isVideo = String(asset.mimeType || "").startsWith("video/");
  return {
    id: `meeting_media_${Date.now()}`,
    type: isVideo ? "video" : "image",
    src: asset.url,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    full_bleed: true,
    fitToSlide: true,
    loop: isVideo,
    muted: false,
    fit: "contain"
  };
}

async function attachRoomMediaToMeeting(meeting, file, youtubeId = "") {
  if (!file && !youtubeId) return true;
  if (file && !/^(image|video)\//.test(file.type || "")) {
    throw new Error("Choose an image or video file for the room visual.");
  }
  if (file && file.size > 100 * 1024 * 1024) {
    throw new Error("Room image or video must be 100 MB or smaller.");
  }
  const asset = youtubeId ? { url: `https://www.youtube.com/watch?v=${youtubeId}`, mimeType: "video/youtube" } : (await api.uploadMedia(file)).asset;
  const { presentation } = await api.getPresentation(meeting.presentationId);
  const slides = Array.isArray(presentation.slides) ? presentation.slides : [];
  const firstSlide = slides[0];
  if (!firstSlide) return true;
  const element = meetingMediaElement(asset);
  if (youtubeId) Object.assign(element, { type: "youtube", youtubeId });
  const canvas = { ...(firstSlide.canvas || {}), background: "#101010", elements: [element] };
  const updated = {
    ...presentation,
    slides: slides.map((slide, index) => index === 0 ? { ...slide, canvas } : slide)
  };
  await api.savePresentation(updated);
  return true;
}

function resetMeetingDialog() {
  meetingForm?.reset();
  document.querySelector("#meetingYouTubePreview").hidden = true;
  privateMeetingNoticeSeen = false;
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
  if (meetingRoomMediaName) meetingRoomMediaName.textContent = "Optional branded visual for the meeting screen.";
  syncMeetingFields();
}

function syncMeetingFields() {
  const timing = meetingForm?.elements.timingMode?.value || "instant";
  const duration = meetingForm?.elements.durationMode?.value || "unlimited";
  const accessType = meetingForm?.elements.accessType?.value || "public";
  const startField = document.querySelector("[data-scheduled-start]");
  const endField = document.querySelector("[data-scheduled-end]");
  const privateNotice = document.querySelector("[data-private-meeting-notice]");
  startField.hidden = timing !== "scheduled";
  endField.hidden = duration !== "timed";
  if (privateNotice) privateNotice.hidden = accessType !== "private";
  startField.querySelector("input").required = timing === "scheduled";
  endField.querySelector("input").required = duration === "timed";
}

function closeMeetingDialog() {
  meetingDialog?.close();
}

createMeetingLinks.forEach(button => button.addEventListener("click", () => {
  resetMeetingDialog();
  meetingDialog.showModal();
}));
meetingForm?.addEventListener("change", syncMeetingFields);
meetingForm?.querySelectorAll('input[name="accessType"]').forEach(input => input.addEventListener("change", () => {
  if (input.value !== "private" || !input.checked || privateMeetingNoticeSeen || !privateMeetingDialog) return;
  privateMeetingNoticeSeen = true;
  if (typeof privateMeetingDialog.showModal === "function") privateMeetingDialog.showModal();
  else showToast("Encrypted private meeting: only permitted participants will be allowed to enter.");
}));
document.querySelector("#privateMeetingAcknowledge")?.addEventListener("click", () => privateMeetingDialog?.close());
privateMeetingDialog?.addEventListener("click", event => { if (event.target === privateMeetingDialog) privateMeetingDialog.close(); });
document.querySelector("#meetingDialogClose")?.addEventListener("click", closeMeetingDialog);
document.querySelector("#meetingCancel")?.addEventListener("click", closeMeetingDialog);
meetingDialog?.addEventListener("click", event => { if (event.target === meetingDialog) closeMeetingDialog(); });
meetingRoomMediaInput?.addEventListener("change", () => {
  const file = meetingRoomMediaInput.files?.[0];
  if (!meetingRoomMediaName) return;
  meetingRoomMediaName.textContent = file ? `${file.name} · will appear on the meeting screen` : "Optional branded visual for the meeting screen.";
});
document.querySelector("#meetingYouTubeUrl")?.addEventListener("input", event => {
  const id = window.SnapKeyYouTube.parse(event.target.value);
  const preview = document.querySelector("#meetingYouTubePreview");
  preview.hidden = !id;
  if (id) preview.src = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
});
meetingForm?.addEventListener("submit", async event => {
  event.preventDefault();
  const submit = document.querySelector("#meetingSubmit");
  const error = document.querySelector("#meetingFormError");
  const timingMode = meetingForm.elements.timingMode.value;
  const durationMode = meetingForm.elements.durationMode.value;
  const now = new Date();
  const scheduledStart = timingMode === "scheduled" ? readLocalDateTime("#meetingScheduledStart") : null;
  const meetingStart = scheduledStart || now;
  const scheduledEnd = durationMode === "timed" ? readLocalDateTime("#meetingScheduledEnd") : null;
  const roomMediaFile = meetingRoomMediaInput?.files?.[0] || null;
  const youtubeUrl = document.querySelector("#meetingYouTubeUrl").value.trim();
  const youtubeId = youtubeUrl ? window.SnapKeyYouTube.parse(youtubeUrl) : "";
  if (youtubeUrl && !youtubeId || youtubeUrl && roomMediaFile) {
    error.textContent = youtubeUrl && roomMediaFile ? "Choose either an uploaded file or a YouTube video." : "Enter a valid YouTube video link.";
    error.hidden = false;
    return;
  }
  if (timingMode === "scheduled" && (!scheduledStart || scheduledStart <= now)) {
    error.textContent = "Choose a future start date and time.";
    error.hidden = false;
    return;
  }
  if (durationMode === "timed" && (!scheduledEnd || scheduledEnd <= meetingStart)) {
    error.textContent = "The end date and time must be after the meeting starts.";
    error.hidden = false;
    return;
  }
  if (roomMediaFile && (!/^(image|video)\//.test(roomMediaFile.type || "") || roomMediaFile.size > 100 * 1024 * 1024)) {
    error.textContent = "Choose an image or video file up to 100 MB.";
    error.hidden = false;
    return;
  }
  error.hidden = true;
  submit.disabled = true;
  const submitLabel = submit.querySelector("span");
  const previousSubmitLabel = submitLabel?.textContent || "";
  try {
    if (submitLabel) submitLabel.textContent = "Creating room";
    const meeting = await api.createMeeting({
      title: document.querySelector("#meetingTitle").value.trim() || "New meeting",
      timingMode,
      durationMode,
      accessType: meetingForm.elements.accessType.value,
      scheduledStart: timingMode === "scheduled" ? scheduledStart.toISOString() : null,
      scheduledEnd: scheduledEnd?.toISOString() || null
    });
    let mediaAttached = false;
    if (roomMediaFile || youtubeId) {
      if (submitLabel) submitLabel.textContent = "Adding media";
      try {
        await attachRoomMediaToMeeting(meeting, roomMediaFile, youtubeId);
        mediaAttached = true;
        const refreshed = await api.listMeetings();
        const accessCode = meeting.accessCode;
        Object.assign(meeting, refreshed.meetings.find(item => item.id === meeting.id) || {});
        meeting.accessCode = accessCode;
      } catch (mediaError) {
        showToast(mediaError.message || "Meeting created, but the room media could not be added.");
      }
    }
    document.querySelector("[data-meeting-form]").hidden = true;
    document.querySelector("[data-meeting-result]").hidden = false;
    document.querySelector("#meetingSubmit").hidden = true;
    document.querySelector("#meetingCancel").textContent = "Done";
    document.querySelector("#meetingResultSummary").textContent = `${meetingStatusLabel(meeting)} · ${meeting.accessType === "private" ? "Private access" : "Public access"}${mediaAttached ? " · Room media added" : ""}`;
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
    if (submitLabel && previousSubmitLabel) submitLabel.textContent = previousSubmitLabel;
  }
});
document.querySelector("[data-copy-meeting-link]")?.addEventListener("click", () => copyText(document.querySelector("#meetingAudienceLink").value, "Audience link copied."));
document.querySelector("[data-copy-meeting-code]")?.addEventListener("click", () => copyText(document.querySelector("#meetingAccessCode").textContent, "Meeting code copied."));

document.querySelector("[data-viewer-share-generate]")?.addEventListener("click", () => createViewerShare());
document.querySelector("[data-viewer-share-regenerate]")?.addEventListener("click", () => {
  if (window.confirm("Replace this link? The existing link will stop working.")) createViewerShare(true);
});
document.querySelector("[data-viewer-share-copy]")?.addEventListener("click", () => copyText(document.querySelector("#viewerShareUrl").value, "Read-only link copied."));
document.querySelector("[data-viewer-share-revoke]")?.addEventListener("click", async event => {
  if (!activeSharePresentationId || !window.confirm("Revoke this link? Anyone using it will lose access.")) return;
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await api.revokeViewerShareLink(activeSharePresentationId);
    displayViewerShare(null);
    showToast("Read-only link revoked.");
  } catch (error) {
    document.querySelector("[data-viewer-share-status]").textContent = error.message || "Could not revoke the link.";
  } finally {
    button.disabled = false;
  }
});
document.addEventListener("click", event => {
  if (event.target.closest(".presentation-options")) return;
  grid?.querySelectorAll("[data-deck-menu]").forEach(menu => { menu.hidden = true; });
  grid?.querySelectorAll("[data-menu-toggle]").forEach(button => button.setAttribute("aria-expanded", "false"));
});

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
  window.location.href = "https://snapkeystudio.com";
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
