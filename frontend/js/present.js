const api = window.PresentStudioApi;
const params = new URLSearchParams(location.search);
const shortJoinMatch = location.pathname.match(/^\/join\/([^/]+)\/?$/);
const audienceJoinLink = Boolean(shortJoinMatch);
let presentationId = params.get("id") || "";
const shareToken = params.get("token") || (shortJoinMatch ? decodeURIComponent(shortJoinMatch[1]) : "");
const participantResumeToken = params.get("resume") || "";
const authToken = localStorage.getItem("presentStudio.accessToken") || "";
const socket = window.io ? window.io({ reconnection: true, reconnectionAttempts: 5, reconnectionDelay: 700 }) : null;
let canvas;
let whiteboardDocument = null;
const $ = (id) => document.getElementById(id);
let presentation; let permission = "viewer"; let currentSlideIndex = 0; let autoplayTimer; let mediaTimer; let mediaIndex = 0; let autoplayRunning = false; let audioEnabled = false; let audioUnlockNeeded = false; let audioUnlockInProgress = false; let screenAccessCode = ""; let screenCodeRequired = false; let liveMediaSession = null; let liveState = null; let currentOutputLabel = "";
function activeSlide() { return presentation.slides[currentSlideIndex]; }
function playback() { return presentation.slides[0]?.canvas?.presentation_playback || { mode: "manual", interval_ms: 5000, slide_ids: [], media_mode: "all", media_cycle: "all", media_interval_ms: 5000, loop_videos: true }; }
function setVisible(element, visible) { if (element) element.hidden = !visible; }
function setStatus(message) { $("presentStatus").textContent = message; }
function takeCohostReturnState(id) {
  if (!id) return {};
  const key = `presentStudio.cohostReturnState.${id}`;
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || "null");
    sessionStorage.removeItem(key);
    if (!value || typeof value !== "object") return {};
    return {
      displayName: String(value.displayName || "").trim().slice(0, 80),
      screenAccessCode: /^\d{4}$/.test(String(value.screenAccessCode || "")) ? String(value.screenAccessCode) : "",
      autoRejoin: value.autoRejoin === true
    };
  } catch {
    try { sessionStorage.removeItem(key); } catch {}
    return {};
  }
}
function setAudienceTheme(theme, remember = true) {
  const nextTheme = theme === "dark" ? "dark" : "light";
  document.body.dataset.audienceTheme = nextTheme;
  document.querySelectorAll("[data-audience-theme-option]").forEach(button => {
    const selected = button.dataset.audienceThemeOption === nextTheme;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
    button.querySelector("b").textContent = selected ? "Selected" : "Use";
  });
  if (remember) try { localStorage.setItem("presentStudio.audienceTheme", nextTheme); } catch {}
}
function bindAudienceSettings() {
  const dialog = $("audienceSettingsDialog");
  const initialTheme = window.SnapKeyAppearance?.theme("presentStudio.audienceTheme") || "light";
  setAudienceTheme(initialTheme, false);
  document.querySelectorAll("[data-audience-theme-option]").forEach(button => button.addEventListener("click", () => setAudienceTheme(button.dataset.audienceThemeOption)));
  $("audienceSettingsButton").addEventListener("click", () => dialog.showModal());
  $("audienceSettingsClose").addEventListener("click", () => dialog.close());
}
function textObject(item) { return new fabric.Textbox(item.text || "", { left: (item.x || 0) * 12.8, top: (item.y || 0) * 7.2, width: (item.width || 40) * 12.8, fontSize: item.fontSize || 42, fontWeight: item.fontWeight || "500", fontStyle: item.fontStyle || "normal", fontFamily: item.fontFamily || "Arial", fill: item.color || "#171717", textAlign: item.textAlign || "left", selectable: false, evented: false }); }
function mediaItems(slide) {
  const config = playback();
  const legacy = (slide.canvas?.elements || []).filter(item => ["image", "video", "youtube"].includes(item.type));
  const fabricVideos = (slide.canvas?.fabric?.objects || []).filter(item => item.mediaType === "video").map(item => ({
    id: item.id, type: "video", src: item.src, full_bleed: item.full_bleed,
    x: ((item.left || 0) / 1280) * 100, y: ((item.top || 0) / 720) * 100,
    width: (((item.width || 0) * (item.scaleX || 1)) / 1280) * 100,
    height: (((item.height || 0) * (item.scaleY || 1)) / 720) * 100,
    loop: item.loop, muted: item.muted, fit: item.fit || "contain"
  }));
  const youtubeVideos = (slide.canvas?.fabric?.objects || []).filter(item => item.mediaType === "youtube" && window.SnapKeyYouTube?.idFor(item)).map(item => ({
    id: item.id, type: "youtube", youtubeId: window.SnapKeyYouTube.idFor(item), src: item.src, full_bleed: item.full_bleed,
    x: ((item.left || 0) / 1280) * 100, y: ((item.top || 0) / 720) * 100,
    width: (((item.width || 0) * (item.scaleX || 1)) / 1280) * 100,
    height: (((item.height || 0) * (item.scaleY || 1)) / 720) * 100
  }));
  return [...legacy, ...fabricVideos, ...youtubeVideos].filter(item => config.media_mode === "all" || config.media_mode === "videos" && item.type === "youtube" || config.media_mode === `${item.type}s`);
}
function screenShareItems(slide) {
  return (slide.canvas?.fabric?.objects || []).filter(item => item.mediaType === "screen-share").map((item, index) => ({
    id: String(item.id || `screen-share-${index}`),
    x: ((item.left || 0) / 1280) * 100, y: ((item.top || 0) / 720) * 100,
    width: (((item.width || 0) * (item.scaleX || 1)) / 1280) * 100,
    height: (((item.height || 0) * (item.scaleY || 1)) / 720) * 100,
    angle: Number(item.angle || 0)
  }));
}
function addScreenShareSlots(layer, slide) {
  screenShareItems(slide).forEach(item => {
    const slot = document.createElement("div");
    slot.className = "slide-media slide-screen-share-slot";
    slot.dataset.slideScreenShare = item.id;
    slot.setAttribute("aria-label", "Live screen share area");
    Object.assign(slot.style, {
      left: `${item.x}%`, top: `${item.y}%`, width: `${item.width}%`, height: `${item.height}%`,
      transform: item.angle ? `rotate(${item.angle}deg)` : ""
    });
    slot.innerHTML = '<span aria-hidden="true">▣</span><strong>Live screen share</strong><small>Click here to select a screen</small>';
    layer.append(slot);
  });
}
function mediaMuted(authoredMuted = false) { return Boolean(authoredMuted || !audioEnabled || audioUnlockNeeded || liveState?.muted); }
function presentationVolume(media, state = liveState) { const raw = media.tagName === "VIDEO" ? state?.videoVolume : state?.audioVolume; const value = raw == null ? NaN : Number(raw); return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1; }
function startPresentationMedia(media) { media.play().catch(() => { media.muted = true; if (permission === "presenter") audioEnabled = false; else audioUnlockNeeded = true; syncAudioButton(); media.play().catch(() => {}); }); }
function renderMedia(slide, preserveExisting = false) {
  const layer = $("presentMedia");
  const existing = preserveExisting ? new Map([...layer.children].filter(node => node.dataset.presentationMediaKey).map(node => [node.dataset.presentationMediaKey, node])) : new Map();
  if (!preserveExisting) layer.replaceChildren();
  const desired = [];
  const config = playback();
  let items = mediaItems(slide);
  if (items.length > 1 && config.media_cycle === "sequential") items = [items[mediaIndex % items.length]];
  if (items.length > 1 && config.media_cycle === "random") items = [items[Math.floor(Math.random() * items.length)]];
  items.forEach((item, index) => {
    const key = item.id ? `${item.id}:${item.youtubeId || item.src || item.type}` : `${item.type}:${item.youtubeId || item.src || index}`;
    const reused = existing.get(key);
    const node = reused || (item.type === "youtube" ? window.SnapKeyYouTube.frame(item) : document.createElement(item.type === "video" ? "video" : "img"));
    if (!node) return;
    node.dataset.presentationMediaKey = key;
    if (reused) node.dataset.mediaReused = "true";
    else if (item.type !== "youtube") node.src = item.src;
    node.className = `slide-media ${item.full_bleed ? "full-bleed" : ""}`;
    node.style.left = `${item.full_bleed ? 0 : item.x || 0}%`;
    node.style.top = `${item.full_bleed ? 0 : item.y || 0}%`;
    node.style.width = `${item.full_bleed ? 100 : item.width || 100}%`;
    node.style.height = `${item.full_bleed ? 100 : item.height || 100}%`;
    node.style.objectFit = item.fit || "contain";
    if (item.type === "video") {
      node.dataset.authoredMuted = String(item.muted === true);
      Object.assign(node, { autoplay: true, muted: mediaMuted(item.muted === true), loop: config.loop_videos !== false && item.loop !== false, playsInline: true, controls: permission === "presenter" && !item.full_bleed });
      node.volume = presentationVolume(node);
    }
    desired.push(node);
    if (item.type === "video" && !reused) startPresentationMedia(node);
    if (item.type === "youtube") window.SnapKeyYouTube.sync(node, { volume: presentationVolume({ tagName: "VIDEO" }), muted: mediaMuted() });
  });
  screenShareItems(slide).forEach(item => {
    const slot = document.createElement("div");
    slot.className = "slide-media slide-screen-share-slot";
    slot.dataset.slideScreenShare = item.id;
    slot.setAttribute("aria-label", "Live screen share area");
    Object.assign(slot.style, { left: `${item.x}%`, top: `${item.y}%`, width: `${item.width}%`, height: `${item.height}%`, transform: item.angle ? `rotate(${item.angle}deg)` : "" });
    slot.innerHTML = '<span aria-hidden="true">▣</span><strong>Live screen share</strong><small>Click here to select a screen</small>';
    desired.push(slot);
  });
  const track = slide.canvas?.audio;
  if (track?.src) {
    const key = `slide-audio:${track.src}`;
    const audio = existing.get(key) || document.createElement("audio");
    if (existing.has(key)) audio.dataset.mediaReused = "true";
    else audio.src = track.src;
    audio.dataset.presentationMediaKey = key;
    audio.dataset.slideMusic = "true";
    Object.assign(audio, { autoplay: true, muted: mediaMuted(), loop: Boolean(track.loop), playsInline: true });
    audio.volume = presentationVolume(audio);
    desired.push(audio);
    if (!existing.has(key)) startPresentationMedia(audio);
  }
  desired.forEach((node, index) => { if (layer.children[index] !== node) layer.insertBefore(node, layer.children[index] || null); });
  [...layer.children].slice(desired.length).forEach(node => node.remove());
  const hasAudio = items.some(item => ["video", "youtube"].includes(item.type)) || Boolean(track?.src);
  setVisible($("audioToggle"), hasAudio);
  syncAudioButton();
}
function syncAudioButton() {
  const button = $("audioToggle");
  if (button) { button.textContent = audioEnabled ? "🔊 Mute audio" : "🔇 Enable audio"; button.setAttribute("aria-label", audioEnabled ? "Mute presentation audio" : "Enable presentation audio"); }
}
async function enablePresentationAudio() {
  audioEnabled = true;
  audioUnlockNeeded = false;
  document.querySelectorAll("#presentMedia iframe[data-youtube-id]").forEach(frame => window.SnapKeyYouTube.sync(frame, { volume: presentationVolume({ tagName: "VIDEO" }), muted: mediaMuted(), playing: liveState?.playing !== false }));
  const attempts = [...document.querySelectorAll("#presentMedia video, #presentMedia audio")].map(media => {
    media.muted = mediaMuted(media.dataset.authoredMuted === "true");
    return media.paused && liveState?.playing === false ? Promise.resolve() : media.play();
  });
  syncAudioButton();
  const results = await Promise.allSettled(attempts);
  const ready = results.every(result => result.status === "fulfilled");
  if (!ready) {
    if (permission === "presenter") audioEnabled = false;
    else audioUnlockNeeded = true;
    document.querySelectorAll("#presentMedia video, #presentMedia audio").forEach(media => { media.muted = true; });
    document.querySelectorAll("#presentMedia iframe[data-youtube-id]").forEach(frame => window.SnapKeyYouTube.sync(frame, { volume: presentationVolume({ tagName: "VIDEO" }), muted: true }));
    syncAudioButton();
  }
  return ready;
}
function toggleAudio() { audioEnabled = !audioEnabled; document.querySelectorAll("#presentMedia video, #presentMedia audio").forEach(media => { media.muted = mediaMuted(media.dataset.authoredMuted === "true"); if (audioEnabled) media.play().catch(() => { audioEnabled = false; media.muted = true; syncAudioButton(); }); }); document.querySelectorAll("#presentMedia iframe[data-youtube-id]").forEach(frame => window.SnapKeyYouTube.sync(frame, { volume: presentationVolume({ tagName: "VIDEO" }), muted: mediaMuted(), playing: audioEnabled && liveState?.playing !== false ? true : undefined })); syncAudioButton(); }
function tryUnlockAudienceAudio() {
  if (permission === "presenter" || audioUnlockInProgress) return;
  const youtubeFrames = [...document.querySelectorAll("#presentMedia iframe[data-youtube-id]")];
  if (!audioUnlockNeeded && !youtubeFrames.length) return;
  audioUnlockInProgress = true;
  youtubeFrames.forEach(frame => window.SnapKeyYouTube.sync(frame, { volume: presentationVolume({ tagName: "VIDEO" }), muted: mediaMuted(), playing: liveState?.playing !== false }));
  enablePresentationAudio().then(ready => {
    if (!ready) return;
    const status = document.querySelector("[data-presentation-audio-status]");
    if (status) status.textContent = liveState?.muted ? "The presenter has muted live sound; it will resume when they unmute it." : "Live presentation sound is on while you wait.";
    window.removeEventListener("pointerdown", tryUnlockAudienceAudio, true);
    window.removeEventListener("keydown", tryUnlockAudienceAudio, true);
  }).finally(() => { audioUnlockInProgress = false; });
}
function annotationCanvases() { return [...document.querySelectorAll("[data-audience-annotation-canvas]")]; }
function annotationTextLayers() { return [...document.querySelectorAll("[data-audience-annotation-text]")]; }
function drawAudienceAnnotation(points = [], color = "#ffd54a", size = 7) {
  if (!points.length) return;
  annotationCanvases().forEach(target => {
    const context = target.getContext("2d");
    context.save();
    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineWidth = Number(size) || 7;
    context.lineCap = "round";
    context.lineJoin = "round";
    if (points.length === 1) {
      context.beginPath();
      context.arc(Math.max(0, Math.min(1, Number(points[0].x) || 0)) * target.width, Math.max(0, Math.min(1, Number(points[0].y) || 0)) * target.height, Math.max(1, context.lineWidth / 2), 0, Math.PI * 2);
      context.fill();
      context.restore();
      return;
    }
    context.beginPath();
    points.forEach((point, index) => {
      const x = Math.max(0, Math.min(1, Number(point.x) || 0)) * target.width;
      const y = Math.max(0, Math.min(1, Number(point.y) || 0)) * target.height;
      if (index) context.lineTo(x, y); else context.moveTo(x, y);
    });
    context.stroke();
    context.restore();
  });
}
function drawAudienceAnnotationShape(payload = {}) {
  const supported = new Set(["line", "arrow", "rectangle", "circle"]);
  if (!supported.has(payload.shape) || !payload.start || !payload.end) return;
  annotationCanvases().forEach(target => {
    const context = target.getContext("2d");
    const startX = Math.max(0, Math.min(1, Number(payload.start.x) || 0)) * target.width;
    const startY = Math.max(0, Math.min(1, Number(payload.start.y) || 0)) * target.height;
    const endX = Math.max(0, Math.min(1, Number(payload.end.x) || 0)) * target.width;
    const endY = Math.max(0, Math.min(1, Number(payload.end.y) || 0)) * target.height;
    const width = endX - startX;
    const height = endY - startY;
    if (Math.hypot(width, height) < 2) return;
    context.save();
    context.strokeStyle = payload.color || "#20242b";
    context.fillStyle = payload.color || "#20242b";
    context.lineWidth = Math.max(2, Number(payload.size) || 2);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    if (payload.shape === "rectangle") context.rect(startX, startY, width, height);
    else if (payload.shape === "circle") context.ellipse(startX + width / 2, startY + height / 2, Math.abs(width / 2), Math.abs(height / 2), 0, 0, Math.PI * 2);
    else { context.moveTo(startX, startY); context.lineTo(endX, endY); }
    context.stroke();
    if (payload.shape === "arrow") {
      const angle = Math.atan2(endY - startY, endX - startX);
      const head = Math.max(12, Math.min(34, context.lineWidth * 2.2));
      context.beginPath();
      context.moveTo(endX, endY);
      context.lineTo(endX - head * Math.cos(angle - Math.PI / 6), endY - head * Math.sin(angle - Math.PI / 6));
      context.lineTo(endX - head * Math.cos(angle + Math.PI / 6), endY - head * Math.sin(angle + Math.PI / 6));
      context.closePath();
      context.fill();
    }
    context.restore();
  });
}
function addAudienceAnnotationText(payload = {}) {
  if (!payload.text) return;
  annotationTextLayers().forEach(target => {
    const label = document.createElement("span");
    label.textContent = String(payload.text).slice(0, 180);
    label.style.left = `${Math.max(0, Math.min(1, Number(payload.point?.x) || 0)) * 100}%`;
    label.style.top = `${Math.max(0, Math.min(1, Number(payload.point?.y) || 0)) * 100}%`;
    label.style.setProperty("--annotation-color", payload.color || "#ffd54a");
    label.style.setProperty("--annotation-size", `${Math.max(18, (Number(payload.size) || 7) * 3.8)}px`);
    target.append(label);
  });
}
function clearAudienceAnnotations() {
  annotationCanvases().forEach(target => target.getContext("2d").clearRect(0, 0, target.width, target.height));
  annotationTextLayers().forEach(target => target.replaceChildren());
}
function applyAudienceViewport(payload = {}) {
  const zoom = Math.max(.5, Math.min(3, Number(payload.zoom) || 1));
  const x = Math.max(-1200, Math.min(1200, Number(payload.x) || 0));
  const y = Math.max(-900, Math.min(900, Number(payload.y) || 0));
  document.querySelectorAll("#presentFrame, .live-presentation-feed-frame").forEach(view => {
    view.style.setProperty("--audience-zoom", String(zoom));
    view.style.setProperty("--audience-pan-x", `${x}px`);
    view.style.setProperty("--audience-pan-y", `${y}px`);
    view.classList.toggle("has-viewport-transform", zoom !== 1 || Boolean(x || y));
  });
}
function handleAudienceAnnotation(event = {}) {
  if (event.presentationId !== presentation?.id) return;
  if (event.type === "draw") drawAudienceAnnotation(event.payload?.points, event.payload?.color, event.payload?.size);
  if (event.type === "shape") drawAudienceAnnotationShape(event.payload);
  if (event.type === "text") addAudienceAnnotationText(event.payload);
  if (event.type === "clear") clearAudienceAnnotations();
  if (event.type === "viewport") applyAudienceViewport(event.payload);
}
function animate(slide) { const frame = $("presentFrame"); const config = slide.canvas?.transition || { type: "fade", duration_ms: 500 }; frame.style.setProperty("--transition-duration", `${config.duration_ms || 500}ms`); frame.classList.remove("transition-fade", "transition-fade-left", "transition-fade-right", "transition-fade-up", "transition-fade-down", "transition-slide", "transition-push-left", "transition-push-right", "transition-push-up", "transition-push-down", "transition-morph", "transition-morph-left", "transition-morph-right", "transition-morph-up", "transition-morph-down", "transition-zoom"); if (config.type && config.type !== "none") requestAnimationFrame(() => { frame.classList.add(`transition-${config.type}`); setTimeout(() => frame.classList.remove(`transition-${config.type}`), config.duration_ms || 500); }); }
function animateObjects() { canvas.getObjects().forEach(object => { const type = object.animation || "none"; if (type === "none") return; const duration = Math.max(100, Math.min(5000, Number(object.animationDuration) || 600)); const delay = Math.max(0, Math.min(5000, Number(object.animationDelay) || 0)); const finalState = { opacity: object.opacity ?? 1, left: object.left || 0, top: object.top || 0, scaleX: object.scaleX || 1, scaleY: object.scaleY || 1 }; const startState = {}; if (type === "fade") Object.assign(startState, { opacity: 0 }); if (type === "zoom") Object.assign(startState, { opacity: 0, scaleX: finalState.scaleX * 0.78, scaleY: finalState.scaleY * 0.78 }); if (type === "fly") Object.assign(startState, { opacity: 0, left: finalState.left - 140 }); if (type === "rise") Object.assign(startState, { opacity: 0, top: finalState.top + 90 }); if (type === "wipe") Object.assign(startState, { opacity: 0, scaleX: finalState.scaleX * 0.08 }); object.set(startState); setTimeout(() => { Object.entries(finalState).forEach(([key, value]) => object.animate(key, value, { duration, easing: fabric.util.ease.easeOutCubic, onChange: canvas.renderAll.bind(canvas), onComplete: () => { object.set(finalState); canvas.requestRenderAll(); } })); }, delay); }); }
function setMediaCycle() { clearInterval(mediaTimer); mediaIndex = 0; if (permission !== "presenter") return; const config = playback(); if (["sequential", "random"].includes(config.media_cycle) && mediaItems(activeSlide()).length > 1) mediaTimer = setInterval(() => { mediaIndex += 1; renderMedia(activeSlide()); }, Number(config.media_interval_ms) || 5000); }
function sanitizeFabricScene(scene) { (scene.objects || []).forEach(object => { if (object.textBaseline === "alphabetical") object.textBaseline = "alphabetic"; }); return scene; }
let slideRenderVersion = 0;
function renderSlide(preserveMedia = false) {
  const renderVersion = ++slideRenderVersion;
  canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
  const slide = activeSlide();
  const data = slide.canvas || {};
  $("presentFrame").dataset.slideId = slide.id;
  $("presentCanvas").hidden = false;
  $("presentFrame").dataset.kind = "slide";
  $("presentFrame").dataset.mediaId = "";
  currentOutputLabel = slide.title || presentation.title;
  canvas.clear();
  canvas.backgroundColor = data.background || "#f8f4ea";
  const done = () => {
    if (renderVersion !== slideRenderVersion) return;
    canvas.getObjects().forEach(object => { object.selectable = false; object.evented = false; });
    canvas.renderAll();
    animateObjects();
  };
  if (data.fabric) {
    const scene = sanitizeFabricScene(JSON.parse(JSON.stringify(data.fabric)));
    const completeScene = scene.objects || [];
    const imageObjects = completeScene.map((object, index) => ({ object, index }))
      .filter(({ object }) => object.type === "image" && object.src);
    scene.objects = completeScene.filter(object =>
      !["video", "youtube", "image"].includes(object.mediaType) && object.type !== "image");
    // Render text and shapes immediately, then restore images at their original
    // Fabric stacking positions. Images are fetched independently; no single
    // slow download should delay a live slide transition.
    canvas.loadFromJSON(scene, () => {
      if (renderVersion !== slideRenderVersion) return;
      done();
      imageObjects.forEach(({ object: serialized, index }) => {
        const loadImage = attempt => {
          fabric.Image.fromURL(serialized.src, image => {
            if (renderVersion !== slideRenderVersion) return;
            if (!image || !image.width || !image.height) {
              if (attempt < 2) setTimeout(() => {
                if (renderVersion === slideRenderVersion) loadImage(attempt + 1);
              }, attempt ? 1800 : 500);
              else console.warn("Slide image unavailable; saved slide data retained", serialized.id || serialized.src);
              return;
            }
            image.set({ ...serialized, selectable: false, evented: false });
            canvas.add(image);
            // Multiple images may arrive out of order. Restore their intended
            // relative layer position rather than always drawing on top.
            const before = completeScene.slice(0, index).filter(obj =>
              !["video", "youtube", "image"].includes(obj.mediaType) && obj.type !== "image" ||
              obj.type === "image" && canvas.getObjects().some(loaded => loaded.id === obj.id)).length;
            canvas.moveTo(image, Math.min(before, canvas.getObjects().length - 1));
            canvas.requestRenderAll();
          }, { crossOrigin: "anonymous" });
        };
        loadImage(0);
      });
    });
  } else {
    const elements = data.elements || [];
    elements.filter(item => item.type === "text").forEach(item => canvas.add(textObject(item)));
    done();
    elements.filter(item => item.type === "image" && item.src).forEach(item => {
      fabric.Image.fromURL(item.src, image => {
        if (!image || renderVersion !== slideRenderVersion) return;
        const boxWidth = Math.max(1, Number(item.width || 40) * 12.8);
        const boxHeight = Math.max(1, Number(item.height || 30) * 7.2);
        const scale = item.full_bleed || item.fit === "fill" ? null : Math.min(boxWidth / image.width, boxHeight / image.height);
        image.set({
          left: Number(item.x || 0) * 12.8,
          top: Number(item.y || 0) * 7.2,
          scaleX: scale || boxWidth / image.width,
          scaleY: scale || boxHeight / image.height,
          selectable: false,
          evented: false
        });
        canvas.add(image);
        if (item.full_bleed) canvas.sendToBack(image);
        canvas.requestRenderAll();
      }, { crossOrigin: "anonymous" });
    });
  }
  renderMedia(slide, preserveMedia);
  setMediaCycle();
  animate(slide);
  $("slideCounter").textContent = `${currentSlideIndex + 1} / ${presentation.slides.length}`;
  setStatus(`${presentation.title} · ${permission === "presenter" ? "Live presenter" : "Live audience"}`);
}

function fabricMediaById(slide, mediaId, kind) {
  return (slide.canvas?.fabric?.objects || []).find((item, index) => (item.mediaType === kind || kind === "video" && item.mediaType === "youtube") && String(item.id || index) === String(mediaId))
    || (slide.canvas?.elements || []).find((item, index) => (item.type === kind || kind === "video" && item.type === "youtube") && String(item.id || index) === String(mediaId));
}

function renderDirectOutput(slide, state) {
  clearInterval(mediaTimer);
  const layer = $("presentMedia");
  layer.replaceChildren();
  canvas.clear();
  $("presentCanvas").hidden = true;
  $("presentFrame").dataset.kind = state.kind;
  $("presentFrame").dataset.mediaId = state.mediaId || "";
  const item = state.kind === "audio" ? slide.canvas?.audio : fabricMediaById(slide, state.mediaId, state.kind);
  currentOutputLabel = item?.audioName || item?.name || `${slide.title || "Slide"} · ${state.kind}`;
  if (state.kind === "audio" && item?.src) {
    const audio = document.createElement("audio");
    audio.src = item.src;
    audio.dataset.slideMusic = "true";
    Object.assign(audio, { autoplay: true, muted: mediaMuted(), loop: Boolean(item.loop), playsInline: true });
    audio.volume = presentationVolume(audio);
    layer.append(audio);
    startPresentationMedia(audio);
  } else if (item?.src) {
    const youtube = item.type === "youtube" || item.mediaType === "youtube";
    const node = youtube ? window.SnapKeyYouTube.frame(item) : document.createElement(state.kind === "video" ? "video" : "img");
    if (!node) return;
    if (!youtube) node.src = item.src;
    node.className = "slide-media full-bleed";
    Object.assign(node.style, { left: "0", top: "0", width: "100%", height: "100%", objectFit: item.fit || "contain" });
    if (state.kind === "video" && !youtube) {
      node.dataset.authoredMuted = String(item.muted === true);
      Object.assign(node, { autoplay: true, muted: mediaMuted(item.muted === true), loop: item.loop !== false, playsInline: true });
      node.volume = presentationVolume(node);
    }
    layer.append(node);
    if (state.kind === "video" && !youtube) startPresentationMedia(node);
    if (youtube) window.SnapKeyYouTube.sync(node, { volume: presentationVolume({ tagName: "VIDEO" }), muted: mediaMuted(), playing: state.playing });
    if (state.kind === "image" && item.audioSrc) {
      const audio = document.createElement("audio");
      audio.src = item.audioSrc;
      audio.hidden = true;
      Object.assign(audio, { autoplay: true, muted: mediaMuted(), playsInline: true });
      audio.volume = presentationVolume(audio);
      layer.append(audio);
      startPresentationMedia(audio);
    }
  }
  $("slideCounter").textContent = `${currentSlideIndex + 1} / ${presentation.slides.length}`;
}

function expectedMediaPosition(state) {
  const position = Math.max(0, Number(state.position) || 0);
  return state.playing && Number.isFinite(Number(state.serverTime)) ? position + Math.max(0, Date.now() - Number(state.serverTime)) / 1000 : position;
}

function syncMediaToState(media, state) {
  const apply = () => {
    const target = expectedMediaPosition(state);
    const drift = target - (Number(media.currentTime) || 0);
    media.muted = mediaMuted(media.dataset.authoredMuted === "true");
    media.volume = presentationVolume(media, state);
    if (!state.playing) {
      media.pause();
      media.playbackRate = 1;
      if (Math.abs(drift) > .08) try { media.currentTime = target; } catch {}
      return;
    }
    if (Math.abs(drift) > .75) { try { media.currentTime = target; } catch {} media.playbackRate = 1; }
    else if (Math.abs(drift) > .12) media.playbackRate = drift > 0 ? 1.04 : .96;
    else media.playbackRate = 1;
    media.play().catch(() => {});
  };
  if (media.readyState >= 1) return apply();
  media._pendingPresentationState = state;
  if (media.dataset.syncMetadataPending) return;
  media.dataset.syncMetadataPending = "true";
  media.addEventListener("loadedmetadata", () => { delete media.dataset.syncMetadataPending; syncMediaToState(media, media._pendingPresentationState || state); }, { once: true });
}

function applyPresentationState(rawState, forceRender = false, preserveMedia = false) {
  const state = { ...rawState, slideId: rawState?.slideId || rawState?.activeSlideId, kind: rawState?.kind || "slide" };
  if (state.presentationId && state.presentationId !== presentation.id) return;
  const found = presentation.slides.findIndex(slide => slide.id === state.slideId);
  if (found < 0) return;
  liveState = state;
  currentSlideIndex = found;
  const frame = $("presentFrame");
  if (["blank", "whiteboard"].includes(state.kind)) {
    clearInterval(mediaTimer);
    $("presentMedia").replaceChildren();
    canvas.clear();
    $("presentCanvas").hidden = state.kind !== 'whiteboard';
    canvas.backgroundColor = state.kind === 'whiteboard' ? '#fff' : '#000';
    canvas.renderAll();
    if (state.kind === 'whiteboard' && whiteboardDocument) window.SnapKeyWhiteboardView?.render(canvas, whiteboardDocument);
    frame.dataset.kind = state.kind;
    frame.dataset.mediaId = "";
    currentOutputLabel = state.kind === 'whiteboard' ? 'Whiteboard' : 'Black screen';
    return;
  }
  const changed = forceRender || frame.dataset.slideId !== state.slideId || (frame.dataset.kind || "slide") !== state.kind || String(frame.dataset.mediaId || "") !== String(state.mediaId || "");
  frame.dataset.slideId = state.slideId;
  if (changed) {
    if (["image", "video", "audio"].includes(state.kind)) renderDirectOutput(activeSlide(), state);
    else renderSlide(preserveMedia);
  }
  document.querySelectorAll("#presentMedia video, #presentMedia audio").forEach(media => {
    if (media.dataset.mediaReused) { media.muted = mediaMuted(media.dataset.authoredMuted === "true"); media.volume = presentationVolume(media, state); delete media.dataset.mediaReused; }
    else syncMediaToState(media, state);
  });
  document.querySelectorAll("#presentMedia iframe[data-youtube-id]").forEach(frame => {
    const reused = frame.dataset.mediaReused;
    window.SnapKeyYouTube.sync(frame, { volume: presentationVolume({ tagName: "VIDEO" }, state), muted: mediaMuted(), ...(reused ? {} : { playing: typeof state.playing === "boolean" ? state.playing : undefined, position: Number.isFinite(Number(state.position)) ? expectedMediaPosition(state) : undefined }) });
    delete frame.dataset.mediaReused;
  });
}
function emitSlide() { socket?.emit("slide_changed", { presentationId: presentation.id, slideId: activeSlide().id, authToken, shareToken }); }
function nextAutoplayIndex() { const config = playback(); if (config.mode === "random") return Math.floor(Math.random() * presentation.slides.length); if (config.mode === "selected") { const selected = presentation.slides.map((slide, index) => config.slide_ids.includes(slide.id) ? index : -1).filter(index => index >= 0); if (selected.length) return selected[(selected.indexOf(currentSlideIndex) + 1 + selected.length) % selected.length]; } return (currentSlideIndex + 1) % presentation.slides.length; }
function go(delta) { if (permission !== "presenter") return; currentSlideIndex = delta === 1 && autoplayRunning ? nextAutoplayIndex() : (currentSlideIndex + delta + presentation.slides.length) % presentation.slides.length; renderSlide(); emitSlide(); }
function setAutoplay(running) { const canAutoplay = permission === "presenter" && playback().mode !== "manual"; autoplayRunning = Boolean(running && canAutoplay); clearInterval(autoplayTimer); if (autoplayRunning) autoplayTimer = setInterval(() => go(1), Number(playback().interval_ms) || 5000); const button = $("autoplayToggle"); button.textContent = autoplayRunning ? "Stop auto play" : canAutoplay ? "Start auto play" : "Auto play: manual"; button.disabled = !canAutoplay; }
function showError(message) { setVisible($("presentLoading"), false); setVisible($("presentStage"), false); setVisible($("presentError"), true); $("errorMessage").textContent = message; }
async function endLive() {
  if (permission !== "presenter") return;
  liveMediaSession?.leave();
  socket?.emit("end_session", { presentationId: presentation.id, authToken, shareToken });
  if (!authToken) return;
  try { await api.endLiveSession(presentation.id); } catch (error) { showError(error.message); }
}
function setupSocket() {
  if (!socket) return;
  const joinRoom = () => { socket.emit("join_presentation", { presentationId: presentation.id, authToken: audienceJoinLink || participantResumeToken ? "" : authToken, shareToken, resumeToken: participantResumeToken }); socket.emit('whiteboard_join', { presentationId: presentation.id, authToken, shareToken, resumeToken: participantResumeToken, screenCode: screenAccessCode }); };
  socket.on('meeting_admission_decision', event => { if (event.presentationId === presentation.id && event.accepted && event.clientId === localStorage.getItem('presentStudio.meetingGuestId')) joinRoom(); });
  socket.on("connect", joinRoom);
  if (socket.connected) joinRoom();
  socket.on("presentation_state", applyPresentationState);
  socket.on('whiteboard_document', event => {
    if (event.presentationId !== presentation.id) return;
    whiteboardDocument = event.document;
    if (liveState?.kind === 'whiteboard') applyPresentationState(liveState, true);
  });
  socket.on("presentation_annotation", handleAudienceAnnotation);
  socket.on("presentation_updated", event => {
    if (event.presentationId !== presentation.id || !event.presentation) return;
    const oldSlide = presentation.slides.find(slide => slide.id === liveState?.slideId);
    const oldCanvas = oldSlide ? JSON.stringify(oldSlide.canvas || {}) : "";
    presentation = event.presentation;
    const state = event.liveState || liveState || { slideId: event.activeSlideId };
    const newSlide = presentation.slides.find(slide => slide.id === (state.slideId || state.activeSlideId));
    const stateSlideId = state.slideId || state.activeSlideId;
    const sameVisibleSlideChanged = (state.kind || "slide") === "slide" && stateSlideId === liveState?.slideId && newSlide && oldCanvas !== JSON.stringify(newSlide.canvas || {});
    applyPresentationState(state, sameVisibleSlideChanged, sameVisibleSlideChanged);
    setAutoplay(autoplayRunning);
  });
  socket.on("presentation_deleted", event => { if (event.presentationId === presentation.id) { setAutoplay(false); liveMediaSession?.leave(); showError("This presentation has been deleted."); } });
  socket.on("presenter_rejected", event => showError(event.message || "Presenter permission required."));
  socket.on("session_ended", () => { setAutoplay(false); liveMediaSession?.leave(); showError("This live session has ended."); });
  if (socket.connected) joinRoom();
}
let standaloneMeeting = false;
let standaloneMeetingAccessType = "";
let meetingEndAt = "";

async function loadPresentationAccess() {
  const audienceRequest = audienceJoinLink || participantResumeToken ? { publicAccess: true } : {};
  if (shareToken) {
    const resolved = await api.resolveShareLink(shareToken, audienceRequest);
    presentationId ||= resolved.presentationId;
    standaloneMeeting = Boolean(resolved.standaloneMeeting);
    meetingEndAt = resolved.scheduledEnd || "";
    standaloneMeetingAccessType = String(
      resolved.meetingAccessType || ""
    ).toLowerCase();
  }
  if (!presentationId) presentationId = "pres_demo";
  if (!shareToken) return api.getPresentation(presentationId, "", audienceRequest, participantResumeToken);

  const result = await api.getPresentation(presentationId, shareToken, audienceRequest, participantResumeToken);
  if (participantResumeToken) {
    screenCodeRequired = false;
    return result;
  }
  if (result.permission === "presenter") {
    screenCodeRequired = false;
    return audienceJoinLink ? { ...result, permission: "viewer" } : result;
  }

  const access = await api.getScreenAccessRequirements(presentationId, shareToken, audienceRequest);
  screenCodeRequired = Boolean(access.requiresCode);
  return result;
}
async function validateMeetingAccessCode() {
  if (!screenCodeRequired) return true;
  const input = document.querySelector("[data-screen-code]");
  const code = input?.value.trim() || "";
  if (!/^\d{4}$/.test(code)) { input?.focus(); throw new Error("Enter the four-digit meeting access code."); }
  await api.verifyScreenAccessCode(presentationId, shareToken, code, audienceJoinLink ? { publicAccess: true } : {});
  screenAccessCode = code;
  return true;
}
async function init() {
  if (!window.fabric) throw new Error("Fabric.js could not be loaded. Check the presentation's network access and reload.");
  canvas = new fabric.StaticCanvas("presentCanvas", { width: 1280, height: 720, selection: false });
  const result = await loadPresentationAccess();
  if (participantResumeToken && result.resumeGuestId) {
    try { localStorage.setItem("presentStudio.meetingGuestId", String(result.resumeGuestId).slice(0, 128)); } catch {}
  }
  presentation = result.presentation;
  permission = result.permission || "viewer";
  if (!presentation.slides.length) throw new Error("This presentation has no slides.");
  const live = await api.getLiveSession(presentation.id);
  const presenter = permission === "presenter";

  const publicStandaloneMeeting = Boolean(
    audienceJoinLink
    && standaloneMeeting
    && standaloneMeetingAccessType === "public"
  );
  audioEnabled = true;
  document.body.classList.toggle("audience-live-view", !presenter);
  document.title = presenter ? `${presentation.title} — Presenter` : `${presentation.title} — Live presentation`;
  const welcomePresentation = document.querySelector("[data-live-welcome-presentation]");
  if (welcomePresentation) {
    welcomePresentation.textContent = publicStandaloneMeeting
      ? `You’re joining “${presentation.title}”. Enter your name to join the meeting.`
      : `You’re watching “${presentation.title}” live. Enter your name${screenCodeRequired ? " and meeting code" : ""} to request a place in the interactive room.`;
  }
  const screenCodeField = document.querySelector("[data-screen-code-field]");
  if (screenCodeField) screenCodeField.hidden = presenter || !screenCodeRequired;
  const cohostReturnState = presenter ? {} : takeCohostReturnState(presentationId);
  if (screenCodeRequired && cohostReturnState.screenAccessCode) {
    screenAccessCode = cohostReturnState.screenAccessCode;
    const screenCodeInput = document.querySelector("[data-screen-code]");
    if (screenCodeInput) screenCodeInput.value = screenAccessCode;
  }
  setVisible($("presentControls"), presenter);
  $("presenterBadge").textContent = presenter ? "Presenter Mode" : "Audience View";
  setVisible($("presenterBadge"), presenter);
  setVisible($("presentMeta"), presenter);
  $("previousSlide").onclick = () => go(-1);
  $("nextSlide").onclick = () => go(1);
  $("autoplayToggle").onclick = () => setAutoplay(!autoplayRunning);
  $("audioToggle").onclick = toggleAudio;
  if (!presenter) {
    window.addEventListener("pointerdown", tryUnlockAudienceAudio, true);
    window.addEventListener("keydown", tryUnlockAudienceAudio, true);
  }
  $("endLive").onclick = endLive;
  document.addEventListener("keydown", event => { if (event.key.toLowerCase() === "f" && presenter) $("fullscreenToggle").click(); if (event.key === "ArrowLeft") go(-1); if (event.key === "ArrowRight") go(1); });
  $("fullscreenToggle").onclick = () => document.fullscreenElement ? document.exitFullscreen() : $("presentStage").requestFullscreen();
  const savedBoard = await api.getWhiteboard(presentation.id, shareToken, { publicAccess: permission !== 'presenter' }, participantResumeToken, screenAccessCode).catch(() => ({ document: null }));
  whiteboardDocument = savedBoard.document;
  applyPresentationState(live, true);
  liveMediaSession = window.SnapKeyLiveMedia?.create({
    root: $("presentLiveMedia"), presentationId, shareToken, resumeToken: participantResumeToken, authToken: audienceJoinLink || participantResumeToken ? "" : authToken, screenAccessCode, socket,
    meetingEndAt,
    admissionBypass: presenter || publicStandaloneMeeting || Boolean(participantResumeToken),
    displayName: cohostReturnState.displayName || result.resumeDisplayName || api.getCachedSession()?.name || "", fullscreenTarget: presenter ? null : $("presentLiveMedia").querySelector(".audience-meeting-stage"), fullscreenOnJoin: false,
    onEnableAudio: enablePresentationAudio,
    onValidateAdmission: validateMeetingAccessCode,
    getScreenAccessCode: () => screenAccessCode,
    requestOptions: audienceJoinLink || participantResumeToken ? { publicAccess: true } : {},
    presentationSource: { canvas: $("presentCanvas"), media: $("presentMedia"), label: () => currentOutputLabel || activeSlide()?.title || presentation.title }
  });
  if (!presenter && (cohostReturnState.autoRejoin || participantResumeToken)) {
    const joinButton = $("presentLiveMedia")?.querySelector("[data-live-join]");
    if (joinButton) {
      const joinStatus = $("presentLiveMedia")?.querySelector("[data-live-status]");
      if (joinStatus) joinStatus.textContent = "Returning you to the audience…";
      queueMicrotask(() => joinButton.click());
    }
  }
  if (presenter) {
    const joinButton = $("presentLiveMedia")?.querySelector("[data-live-join]");
    if (joinButton) {
      joinButton.textContent = "Join meeting";
      joinButton.setAttribute("aria-label", "Join meeting as owner");
    }
    const joinStatus = $("presentLiveMedia")?.querySelector("[data-live-status]");
    if (joinStatus) joinStatus.textContent = "Joining as presentation owner…";
    queueMicrotask(() => liveMediaSession?.join?.(true));
  }
  setVisible($("presentLoading"), false);
  setVisible($("presentStage"), true);
  setAutoplay(playback().mode !== "manual");
  setupSocket();
}
bindAudienceSettings();
init().catch(error => { if (!window.SnapKeyBreakoutRooms?.recover(presentationId)) showError(error.message); });
