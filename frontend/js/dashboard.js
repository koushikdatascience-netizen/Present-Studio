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
const meetingInviteDialog = document.querySelector("#meetingInviteDialog");
const meetingTemplateSelect = document.querySelector("#meetingTemplateSelect");

let toastTimer = null;
let dashboardPresentations = [];
let dashboardMeetings = [];
let privateMeetingNoticeSeen = false;
let dashboardThumbnailCanvases = [];
let activeSharePresentationId = "";
let dashboardTotals = null;
let thumbnailObserver = null;
let meetingForInvite = null;
let meetingInviteChannel = "email";
let meetingMessageTemplates = [];
let editingMeetingTemplateId = "";
let whatsappInviteRecipients = [];
let whatsappInviteIndex = 0;

function renderDashboardThumbnails(presentations) {
  if (!window.fabric) return;
  const renderThumbnail = element => {
    const deck = presentations.find(item => item.id === element.dataset.deckThumbnail);
    const data = deck?.slides?.[0]?.canvas || {};
    const thumbnail = new fabric.StaticCanvas(element, { width: 320, height: 180, renderOnAddRemove: false, enableRetinaScaling: false });
    thumbnail.setViewportTransform([0.25, 0, 0, 0.25, 0, 0]);
    const objectOrder = new WeakMap();
    dashboardThumbnailCanvases.push(thumbnail);
    const render = () => {
      if (!dashboardThumbnailCanvases.includes(thumbnail)) return;
      if (data.fabric) {
        const adjust = objects => objects.forEach(object => {
          if (object.thumbnailSrc && object.type === 'image' && !object.__previewAdjusted) {
            const element = object.getElement();
            const width = element.naturalWidth || element.width;
            const height = element.naturalHeight || element.height;
            if (width && height) {
              const ratioX = width / object.width, ratioY = height / object.height;
              object.set({ scaleX: object.scaleX / ratioX, scaleY: object.scaleY / ratioY,
                cropX: (object.cropX || 0) * ratioX, cropY: (object.cropY || 0) * ratioY, width, height });
              object.__previewAdjusted = true;
            }
          }
          if (object._objects) adjust(object._objects);
        });
        adjust(thumbnail.getObjects());
      }
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
      const node = document.createElement(youtubeId || object.thumbnailUrl || object.poster ? 'img' : 'video');
      node.className = 'dashboard-slide-media';
      if (node.tagName === 'IMG') { node.src = object.thumbnailUrl || (youtubeId ? `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg` : object.poster); node.alt = ''; }
      else { node.src = object.src || ''; node.muted = true; node.preload = 'metadata'; node.playsInline = true; node.addEventListener('loadedmetadata', () => { try { node.currentTime = Math.min(0.1, node.duration / 2); } catch {} }, { once: true }); }
      const legacy = object.legacy;
      Object.assign(node.style, { left: `${legacy ? Number(object.x || 0) : Number(object.left || 0) / 12.8}%`, top: `${legacy ? Number(object.y || 0) : Number(object.top || 0) / 7.2}%`, width: `${legacy ? Number(object.width || 100) : Number(object.width || 1280) * Number(object.scaleX || 1) / 12.8}%`, height: `${legacy ? Number(object.height || 100) : Number(object.height || 720) * Number(object.scaleY || 1) / 7.2}%`, objectFit: object.fit === 'contain' ? 'contain' : 'cover' });
      element.parentElement.append(node);
    });
  };
  thumbnailObserver?.disconnect();
  if (window.IntersectionObserver) {
    thumbnailObserver = new IntersectionObserver(entries => {
      entries.filter(entry => entry.isIntersecting).forEach(entry => {
        thumbnailObserver.unobserve(entry.target);
        renderThumbnail(entry.target);
      });
    }, { rootMargin: "150px" });
    grid.querySelectorAll('[data-deck-thumbnail]').forEach(element => thumbnailObserver.observe(element));
  } else grid.querySelectorAll('[data-deck-thumbnail]').forEach(renderThumbnail);
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
  document.querySelector("#presentationCount").textContent = String(dashboardTotals?.total ?? presentations.length).padStart(2, "0");
  const recentDeck = presentations.find(deck => deck.updatedAt);
  document.querySelector("#recentCount").textContent = recentDeck?.updatedAt
    ? new Date(recentDeck.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : "Draft";
  document.querySelector("#slideTotal").textContent = String(dashboardTotals?.slideTotal ?? presentations.reduce((total, deck) => total + (deck.slideCount ?? deck.slides?.length ?? 0), 0)).padStart(2, "0");
}

function filteredPresentations() {
  const query = searchInput?.value.trim().toLowerCase() || "";
  return dashboardPresentations.filter(deck => String(deck.title || "").toLowerCase().includes(query));
}

function renderDecks(presentations) {
  if (!grid) return;
  thumbnailObserver?.disconnect();
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
    const slides = deck.slideCount ?? (Array.isArray(deck.slides) ? deck.slides.length : 0);
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
      if (dashboardTotals) { dashboardTotals.total--; dashboardTotals.slideTotal -= deck.slideCount ?? deck.slides?.length ?? 0; }
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
  // A slow meeting request must not hold up presentation cards.
  api.listMeetings().then(({ meetings }) => {
    dashboardMeetings = meetings;
    renderMeetings(meetings);
  }).catch(error => {
    if (meetingGrid) meetingGrid.innerHTML = `<p class="dashboard-status error">${escapeHtml(error.message)}</p>`;
  });
  let page = await api.listPresentationSummaries();
  dashboardTotals = { total: page.total, slideTotal: page.slideTotal };
  dashboardPresentations = page.presentations;
  updateDashboardStats(dashboardPresentations);
  renderDecks(dashboardPresentations);
  // Additional small pages arrive after the first cards are already usable.
  while (page.hasMore) {
    try { page = await api.listPresentationSummaries(dashboardPresentations.length); }
    catch (error) { showToast(error.message); break; }
    const seen = new Set(dashboardPresentations.map(deck => deck.id));
    const next = page.presentations.filter(deck => !seen.has(deck.id));
    if (!next.length) break;
    dashboardPresentations.push(...next);
    renderDecks(filteredPresentations());
  }
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

function defaultMeetingTemplate(channel) {
  return channel === "email" ? {
    id: "default-email",
    channel,
    name: "Professional meeting invitation",
    subject: "Invitation: {{meeting_title}}",
    body: "Hello,\n\nYou’re invited to join {{meeting_title}}, hosted by {{owner_name}}.\n\nDate: {{meeting_date}}\nTime: {{meeting_time}}\n\nJoin the meeting: {{audience_link}}\nAccess code: {{access_code}}\n\nWe look forward to seeing you.\n\nBest,\n{{owner_name}}"
  } : {
    id: "default-whatsapp",
    channel,
    name: "Friendly WhatsApp invitation",
    subject: "",
    body: "Hi! You’re invited to *{{meeting_title}}* with {{owner_name}}.\n\n📅 {{meeting_date}} · {{meeting_time}}\n🔗 Join here: {{audience_link}}\n🔐 Access code: {{access_code}}\n\nHope you can make it!"
  };
}

function meetingTemplateContext() {
  const meeting = meetingForInvite || {};
  const start = meeting.scheduledStart ? new Date(meeting.scheduledStart) : null;
  const session = api.getCachedSession?.();
  return {
    meeting_title: meeting.title || "Meeting",
    owner_name: session?.name || "Your host",
    meeting_date: start && !Number.isNaN(start.getTime()) ? start.toLocaleDateString([], { dateStyle: "long" }) : "To be confirmed",
    meeting_time: meeting.timingMode === "instant" ? "Starting now" : start && !Number.isNaN(start.getTime()) ? start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "To be confirmed",
    audience_link: meeting.audienceUrl || "",
    access_code: meeting.accessCode || (meeting.accessType === "private" ? "Ask the host for the access code" : "No code required")
  };
}

function fillMeetingTemplate(templateText) {
  const values = meetingTemplateContext();
  return String(templateText || "").replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (token, key) => {
    const value = values[key.toLowerCase()];
    return value === undefined ? token : value;
  });
}

function selectedMeetingTemplate() {
  const id = meetingTemplateSelect?.value || "";
  return meetingMessageTemplates.find(template => template.id === id) || defaultMeetingTemplate(meetingInviteChannel);
}

function renderMeetingTemplateOptions(selectedId = "") {
  if (!meetingTemplateSelect) return;
  meetingTemplateSelect.replaceChildren();
  const builtIn = defaultMeetingTemplate(meetingInviteChannel);
  const templates = [builtIn, ...meetingMessageTemplates.filter(template => template.channel === meetingInviteChannel)];
  templates.forEach(template => {
    const option = document.createElement("option");
    option.value = template.id;
    option.textContent = `${template.name}${template.id.startsWith("default-") ? " · Starter" : ""}`;
    meetingTemplateSelect.append(option);
  });
  meetingTemplateSelect.value = templates.some(template => template.id === selectedId) ? selectedId : builtIn.id;
  updateMeetingTemplatePreview();
}

function updateMeetingTemplatePreview() {
  const template = selectedMeetingTemplate();
  const editor = document.querySelector("[data-meeting-template-editor]");
  const editing = editor && !editor.hidden;
  const subject = editing ? document.querySelector("#meetingTemplateSubject").value : template.subject;
  const body = editing ? document.querySelector("#meetingTemplateBody").value : template.body;
  const subjectPreview = document.querySelector("[data-meeting-template-subject]");
  subjectPreview.textContent = subject ? `Subject: ${fillMeetingTemplate(subject)}` : "";
  subjectPreview.hidden = !subject;
  document.querySelector("[data-meeting-template-preview]").textContent = fillMeetingTemplate(body);
}

function setMeetingInviteStatus(message, kind = "") {
  const status = document.querySelector("[data-meeting-invite-status]");
  status.textContent = message;
  status.dataset.kind = kind;
}

function openMeetingInvite(channel, meeting) {
  meetingInviteChannel = channel;
  meetingForInvite = meeting;
  editingMeetingTemplateId = "";
  whatsappInviteRecipients = [];
  whatsappInviteIndex = 0;
  const isEmail = channel === "email";
  document.querySelector("#meetingInviteTitle").textContent = isEmail ? "Share by email" : "Share on WhatsApp";
  document.querySelector("[data-invite-explainer]").textContent = isEmail
    ? "Send email invitations directly from SnapKey Studio."
    : "Send approved WhatsApp invitations directly from SnapKey Studio.";
  document.querySelector("[data-invite-recipients-label]").textContent = isEmail ? "Email addresses" : "WhatsApp phone numbers";
  const recipients = document.querySelector("#meetingInviteRecipients");
  recipients.value = "";
  recipients.placeholder = isEmail ? "name@example.com, team@example.com" : "+1 555 010 1234, +1 555 010 5678";
  document.querySelector("[data-invite-recipient-help]").textContent = isEmail
    ? "Separate email addresses with commas."
    : "Include country codes and separate numbers with commas.";
  document.querySelector("[data-template-subject-field]").hidden = !isEmail;
  document.querySelector("[data-send-meeting-invite] span").textContent = "Send invitations";
  document.querySelector("[data-send-meeting-invite] i").className = isEmail ? "bi bi-envelope" : "bi bi-whatsapp";
  const sendButton = document.querySelector("[data-send-meeting-invite]");
  sendButton.disabled = false;
  sendButton.querySelector("span").textContent = "Send invitations";
  document.querySelector("[data-meeting-template-editor]").hidden = true;
  document.querySelector("[data-delete-meeting-template]").hidden = true;
  document.querySelector("[data-template-editor-title]").textContent = "Create a template";
  setMeetingInviteStatus("");
  renderMeetingTemplateOptions();
  if (!meetingInviteDialog.open) meetingInviteDialog.showModal();
  configureDirectInvites();
  api.listMeetingMessageTemplates().then(result => {
    meetingMessageTemplates = result.templates || [];
    renderMeetingTemplateOptions(meetingTemplateSelect.value);
    if (meetingInviteChannel === "whatsapp") updateMetaInvitePreview();
  }).catch(error => setMeetingInviteStatus(error.message || "Could not load your saved templates.", "error"));
}

function beginMeetingTemplateEdit(template = null) {
  const editor = document.querySelector("[data-meeting-template-editor]");
  const selected = template || selectedMeetingTemplate();
  const isSaved = !String(selected.id).startsWith("default-");
  editingMeetingTemplateId = isSaved ? selected.id : "";
  document.querySelector("#meetingTemplateName").value = isSaved ? selected.name : "";
  document.querySelector("#meetingTemplateSubject").value = selected.subject || "";
  document.querySelector("#meetingTemplateBody").value = selected.body || "";
  document.querySelector("[data-template-editor-title]").textContent = editingMeetingTemplateId ? "Edit saved template" : "Create a template";
  document.querySelector("[data-delete-meeting-template]").hidden = !editingMeetingTemplateId;
  editor.hidden = false;
  updateMeetingTemplatePreview();
  document.querySelector("#meetingTemplateName").focus();
}

function parseInviteRecipients(channel) {
  const raw = document.querySelector("#meetingInviteRecipients").value;
  const values = [...new Set(raw.split(/[\n,;]+/).map(value => value.trim()).filter(Boolean))];
  if (!values.length) throw new Error(channel === "email" ? "Enter at least one email address." : "Enter at least one WhatsApp phone number.");
  if (values.length > 100) throw new Error("Send to at most 100 recipients at a time.");
  if (channel === "email") {
    const invalid = values.find(value => !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(value));
    if (invalid) throw new Error(`Check this email address: ${invalid}`);
    return values;
  }
  return values.map(value => {
    const digits = value.replace(/[\s().-]/g, "").replace(/^\+/, "");
    if (!/^[1-9]\d{7,14}$/.test(digits)) throw new Error(`Add a country code and check this phone number: ${value}`);
    return digits;
  });
}

async function sendMeetingInvite() {
  const button = document.querySelector("[data-send-meeting-invite]");
  if (button.disabled) return;
  try {
    const recipients = [...new Set(parseInviteRecipients(meetingInviteChannel))];
    if (!document.querySelector("#inviteRecipientConsent").checked) throw new Error("Confirm recipients agreed to receive invitations.");
    if (!document.querySelector("[data-meeting-template-editor]").hidden) throw new Error("Save your template before sending.");
    const template = selectedMeetingTemplate();
    const payload = {meetingId: meetingForInvite.id, channel: meetingInviteChannel, recipients, consent: true, subject: fillMeetingTemplate(template.subject || "Meeting invitation"), body: fillMeetingTemplate(template.body)};
    if (meetingInviteChannel === "whatsapp") {
      const meta = selectedMetaInviteTemplate();
      if (!meta) throw new Error("Choose an approved WhatsApp text template.");
      payload.templateName = meta.name; payload.language = meta.language;
      payload.parameters = [...document.querySelectorAll("[data-meta-parameter]")].map(input => fillMeetingTemplate(input.value).trim());
      if (payload.parameters.some(value => !value)) throw new Error("Fill all WhatsApp variables.");
    }
    if (!window.confirm(`Send ${meetingInviteChannel} invitations to ${recipients.length} recipients?`)) return;
    const signature = JSON.stringify(payload);
    if (inviteRequestCache?.signature !== signature) inviteRequestCache = {signature, id: window.crypto.randomUUID()};
    button.disabled = true;
    await api.sendInvitations({...payload, requestId: inviteRequestCache.id});
    setMeetingInviteStatus(`Queued ${recipients.length} invitations. Open Delivery history to track each recipient. Email accepted means accepted by the mail server, not confirmed inbox delivery.`, "success");
    await refreshInviteHistory();
  } catch(error) {setMeetingInviteStatus(error.message || "Could not queue invitations.", "error"); button.disabled = false;}
}

document.querySelectorAll("[data-open-meeting-invite]").forEach(button => button.addEventListener("click", () => {
  if (!meetingForInvite) return;
  openMeetingInvite(button.dataset.openMeetingInvite, meetingForInvite);
}));
document.querySelectorAll("[data-close-meeting-invite]").forEach(button => button.addEventListener("click", () => meetingInviteDialog?.close()));
meetingInviteDialog?.addEventListener("click", event => { if (event.target === meetingInviteDialog) meetingInviteDialog.close(); });
meetingTemplateSelect?.addEventListener("change", () => {
  editingMeetingTemplateId = "";
  document.querySelector("[data-meeting-template-editor]").hidden = true;
  updateMeetingTemplatePreview();
});
document.querySelector("[data-new-meeting-template]")?.addEventListener("click", () => beginMeetingTemplateEdit());
document.querySelector("[data-edit-meeting-template]")?.addEventListener("click", () => beginMeetingTemplateEdit());
document.querySelectorAll("#meetingTemplateSubject, #meetingTemplateBody").forEach(input => input.addEventListener("input", updateMeetingTemplatePreview));
document.querySelector("[data-save-meeting-template]")?.addEventListener("click", async event => {
  const button = event.currentTarget;
  const payload = {
    channel: meetingInviteChannel,
    name: document.querySelector("#meetingTemplateName").value.trim(),
    subject: meetingInviteChannel === "email" ? document.querySelector("#meetingTemplateSubject").value.replace(/[\r\n]+/g, " ").trim() : "",
    body: document.querySelector("#meetingTemplateBody").value.trim()
  };
  if (!payload.name || !payload.body) return setMeetingInviteStatus("Enter a template name and message before saving.", "error");
  button.disabled = true;
  try {
    const result = editingMeetingTemplateId
      ? await api.updateMeetingMessageTemplate(editingMeetingTemplateId, payload)
      : await api.createMeetingMessageTemplate(payload);
    const saved = result.template;
    meetingMessageTemplates = [...meetingMessageTemplates.filter(item => item.id !== saved.id), saved];
    renderMeetingTemplateOptions(saved.id);
    document.querySelector("[data-meeting-template-editor]").hidden = true;
    editingMeetingTemplateId = "";
    updateMeetingTemplatePreview();
    setMeetingInviteStatus("Template saved to your account.", "success");
  } catch (error) {
    setMeetingInviteStatus(error.message || "Could not save this template.", "error");
  } finally { button.disabled = false; }
});
document.querySelector("[data-delete-meeting-template]")?.addEventListener("click", async event => {
  if (!editingMeetingTemplateId || !window.confirm("Delete this saved message template?")) return;
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await api.deleteMeetingMessageTemplate(editingMeetingTemplateId);
    meetingMessageTemplates = meetingMessageTemplates.filter(item => item.id !== editingMeetingTemplateId);
    editingMeetingTemplateId = "";
    document.querySelector("[data-meeting-template-editor]").hidden = true;
    renderMeetingTemplateOptions();
    setMeetingInviteStatus("Template deleted.", "success");
  } catch (error) { setMeetingInviteStatus(error.message || "Could not delete this template.", "error"); }
  finally { button.disabled = false; }
});
document.querySelector("[data-send-meeting-invite]")?.addEventListener("click", sendMeetingInvite);

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
  meetingForInvite = null;
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
    meetingForInvite = meeting;
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

let metaInviteTemplates = [];
let inviteRequestCache = null;
let inviteConfigGeneration = 0;
let inviteHistoryTimer = 0;
function selectedMetaInviteTemplate() {return metaInviteTemplates[Number(document.querySelector('#metaInviteTemplate').value)];}
function updateMetaInvitePreview() {
  const template = selectedMetaInviteTemplate();
  const values = [...document.querySelectorAll('[data-meta-parameter]')].map(input => fillMeetingTemplate(input.value));
  document.querySelector('[data-meeting-template-subject]').hidden = true;
  document.querySelector('[data-meeting-template-preview]').textContent = template ? template.body.replace(/\{\{(\d+)\}\}/g, (token, index) => values[Number(index) - 1] || token) : 'Choose an approved WhatsApp template.';
}
function renderMetaInviteParameters() {
  const template = selectedMetaInviteTemplate();
  const host = document.querySelector('#metaInviteParameters'); host.replaceChildren();
  if (!template) return;
  let saved = [];
  try {saved = JSON.parse(localStorage.getItem(`snapkey.metaMapping.${template.name}.${template.language}`) || '[]');} catch {}
  for (let index = 0; index < template.parameters; index++) {
    const label = document.createElement('label'); label.className = 'meeting-invite-field';
    const title = document.createElement('span'); title.textContent = `Variable {{${index + 1}}}`;
    const input = document.createElement('input'); input.dataset.metaParameter = String(index); input.maxLength = 1000;
    input.placeholder = 'Type a value or {{audience_link}}, {{meeting_title}}, {{meeting_time}}'; input.value = saved[index] || '';
    input.addEventListener('input', updateMetaInvitePreview); label.append(title, input); host.append(label);
  }
  updateMetaInvitePreview();
}
async function configureDirectInvites() {
  const generation = ++inviteConfigGeneration;
  const channel = meetingInviteChannel;
  const whatsapp = channel === 'whatsapp';
  const send = document.querySelector('[data-send-meeting-invite]'); send.disabled = true;
  send.querySelector('span').textContent = 'Send invitations';
  document.querySelector('[data-invite-explainer]').textContent = 'Send directly from SnapKey Studio. Review the recipients and message before sending.';
  document.querySelector('[data-invite-recipient-help]').textContent = 'Type individually or paste comma-separated recipients. Include country codes for WhatsApp. Maximum 100 recipients.';
  document.querySelector('#inviteRecipientConsent').checked = false;
  document.querySelector('[data-meta-invite]').hidden = !whatsapp;
  document.querySelector('.meeting-template-picker').hidden = whatsapp;
  document.querySelector('[data-edit-meeting-template]').hidden = whatsapp;
  try {
    const configuration = await api.invitationConfiguration();
    if (generation !== inviteConfigGeneration) return;
    if (!configuration[channel]) throw new Error(`${whatsapp ? 'WhatsApp' : 'Email'} sending is not configured. Ask your administrator to add the server environment settings.`);
    if (whatsapp) {
      const result = await api.whatsappInvitationTemplates();
      if (generation !== inviteConfigGeneration) return;
      metaInviteTemplates = result.templates.filter(template => template.supported);
      const select = document.querySelector('#metaInviteTemplate'); select.replaceChildren();
      metaInviteTemplates.forEach((template, index) => {const option = document.createElement('option'); option.value = String(index); option.textContent = `${template.name} · ${template.language}`; select.append(option);});
      if (!metaInviteTemplates.length) throw new Error('No approved text templates available. Create a body-text template in Meta WhatsApp Manager. Dynamic headers and buttons require a dedicated composer.');
      renderMetaInviteParameters();
    }
    send.disabled = false;
  } catch(error) {if (generation === inviteConfigGeneration) setMeetingInviteStatus(error.message, 'error');}
  window.clearInterval(inviteHistoryTimer);
  if (generation === inviteConfigGeneration) {refreshInviteHistory(); inviteHistoryTimer = window.setInterval(refreshInviteHistory, 5000);}
}
async function refreshInviteHistory() {
  if (!meetingInviteDialog.open) return;
  const host = document.querySelector('#inviteDeliveryHistory');
  try {
    const result = await api.invitationHistory();
    const openIds = new Set([...host.querySelectorAll('details[open]')].map(node => node.dataset.batchId));
    host.replaceChildren();
    const batches = result.batches.filter(batch => batch.meetingId === meetingForInvite?.id);
    if (!batches.length) host.textContent = 'No invitations sent for this meeting yet.';
    batches.forEach(batch => {
      const group = document.createElement('details'); group.dataset.batchId = batch.id; group.open = openIds.has(batch.id);
      const summary = document.createElement('summary'); summary.textContent = `${batch.channel} · ${batch.deliveries.length} recipients · ${batch.deliveries.filter(d => ['accepted','sent','delivered','read'].includes(d.status)).length} accepted or delivered`; group.append(summary);
      batch.deliveries.forEach(delivery => {
        const row = document.createElement('p'); row.textContent = `${delivery.recipient} — ${delivery.status}${delivery.error ? ': ' + delivery.error : ''}`;
        if (delivery.status === 'failed') {
          const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Retry';
          retry.onclick = async () => {retry.disabled = true; try {await api.retryInvitation(delivery.id); await refreshInviteHistory();} catch(error) {setMeetingInviteStatus(error.message, 'error'); retry.disabled = false;}};
          row.append(retry);
        }
        group.append(row);
      });
      host.append(group);
    });
  } catch {host.textContent = 'Could not refresh delivery history.';}
}
document.querySelector('#metaInviteTemplate')?.addEventListener('change', renderMetaInviteParameters);
document.querySelector('#saveMetaInviteMapping')?.addEventListener('click', () => {
  const template = selectedMetaInviteTemplate(); if (!template) return;
  try {localStorage.setItem(`snapkey.metaMapping.${template.name}.${template.language}`, JSON.stringify([...document.querySelectorAll('[data-meta-parameter]')].map(input => input.value))); setMeetingInviteStatus('Variable mapping saved on this device.', 'success');} catch {setMeetingInviteStatus('Could not save variable mapping.', 'error');}
});
meetingInviteDialog?.addEventListener('close', () => {++inviteConfigGeneration; window.clearInterval(inviteHistoryTimer);});
document.querySelector('#submitMetaInviteTemplate')?.addEventListener('click', async event => {
  const button = event.currentTarget; button.disabled = true;
  try {
    await api.createWhatsAppInvitationTemplate({name: document.querySelector('#metaNewName').value.trim(), language: document.querySelector('#metaNewLanguage').value.trim(), category: document.querySelector('#metaNewCategory').value, body: document.querySelector('#metaNewBody').value.trim(), examples: document.querySelector('#metaNewExamples').value.split('\n').map(value => value.trim()).filter(Boolean)});
    setMeetingInviteStatus('Template submitted to Meta. Reopen this dialog after approval to use it.', 'success');
  } catch(error) {setMeetingInviteStatus(error.message || 'Could not submit template.', 'error');}
  finally {button.disabled = false;}
});
