(() => {
  "use strict";

  const params = new URLSearchParams(location.search);
  const match = location.pathname.match(/^\/presentation\/([^/]+)\/?$/);
  const token = params.get("token") || (match ? decodeURIComponent(match[1]) : "");
  const byId = id => document.getElementById(id);
  const stage = byId("viewerStage");
  const layer = byId("viewerMedia");
  const message = byId("viewerMessage");
  const controls = byId("viewerControls");
  let presentation;
  let canvas;
  let index = 0;
  let autoplayTimer;
  let autoplay = false;

  function mediaItems(slide) {
    const legacy = (slide.canvas?.elements || []).filter(item => ["image", "video", "youtube"].includes(item.type));
    const fabricMedia = (slide.canvas?.fabric?.objects || []).filter(item => ["video", "youtube"].includes(item.mediaType)).map(item => ({
      id: item.id,
      type: item.mediaType,
      src: item.src,
      youtubeId: item.youtubeId,
      full_bleed: item.full_bleed,
      x: (Number(item.left) || 0) / 12.8,
      y: (Number(item.top) || 0) / 7.2,
      width: (Number(item.width) || 1280) * (Number(item.scaleX) || 1) / 12.8,
      height: (Number(item.height) || 720) * (Number(item.scaleY) || 1) / 7.2,
      fit: item.fit || "contain",
      loop: item.loop
    }));
    return [...legacy, ...fabricMedia];
  }

  function youtubeId(item) {
    const direct = String(item.youtubeId || "");
    if (/^[A-Za-z0-9_-]{11}$/.test(direct)) return direct;
    try {
      const url = new URL(item.src);
      const parts = url.pathname.split("/").filter(Boolean);
      const id = ["youtu.be", "www.youtu.be"].includes(url.hostname) ? parts[0]
        : ["youtube.com", "www.youtube.com", "m.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"].includes(url.hostname)
          ? (parts[0] === "watch" ? url.searchParams.get("v") : ["embed", "shorts", "live"].includes(parts[0]) ? parts[1] : "") : "";
      return /^[A-Za-z0-9_-]{11}$/.test(id || "") ? id : "";
    } catch { return ""; }
  }

  function setMediaPosition(node, item) {
    Object.assign(node.style, {
      left: `${item.full_bleed ? 0 : Number(item.x || 0)}%`,
      top: `${item.full_bleed ? 0 : Number(item.y || 0)}%`,
      width: `${item.full_bleed ? 100 : Number(item.width || 100)}%`,
      height: `${item.full_bleed ? 100 : Number(item.height || 100)}%`,
      objectFit: item.fit || "contain"
    });
  }

  function addMedia(item) {
    const isYoutube = item.type === "youtube" || item.mediaType === "youtube";
    const id = isYoutube ? youtubeId(item) : "";
    if (isYoutube && !id) return;
    if (!isYoutube && !item.src) return;
    let node;
    if (isYoutube) {
      node = document.createElement("iframe");
      node.src = `https://www.youtube-nocookie.com/embed/${id}?playsinline=1&controls=1&rel=0`;
      node.title = "Presentation video";
      node.allow = "autoplay; encrypted-media; fullscreen; picture-in-picture";
      node.allowFullscreen = true;
      node.referrerPolicy = "strict-origin-when-cross-origin";
    } else {
      node = document.createElement(item.type === "video" ? "video" : "img");
      node.src = item.src;
      if (node.tagName === "VIDEO") Object.assign(node, { controls: true, playsInline: true, loop: item.loop !== false, muted: true, preload: "metadata" });
      if (node.tagName === "IMG") { node.alt = item.alt || ""; node.loading = "eager"; }
    }
    node.className = "share-viewer-media-item";
    setMediaPosition(node, item);
    layer.append(node);
  }

  function transition(slide) {
    const config = slide.canvas?.transition || { type: "fade", duration_ms: 500 };
    const type = String(config.type || "fade");
    const allowed = new Set(["fade", "fade-left", "fade-right", "fade-up", "fade-down", "slide", "push-left", "push-right", "push-up", "push-down", "morph", "morph-left", "morph-right", "morph-up", "morph-down", "zoom"]);
    stage.className = "share-viewer-stage";
    stage.style.setProperty("--transition-duration", `${Math.max(0, Math.min(5000, Number(config.duration_ms) || 500))}ms`);
    if (!allowed.has(type) || type === "none") return;
    requestAnimationFrame(() => {
      stage.classList.add(`transition-${type}`);
      window.setTimeout(() => stage.classList.remove(`transition-${type}`), Math.max(0, Number(config.duration_ms) || 500));
    });
  }

  function render() {
    const slide = presentation.slides[index];
    if (!slide) return;
    const data = slide.canvas || {};
    layer.replaceChildren();
    canvas.clear();
    canvas.backgroundColor = data.background || "#f8f4ea";
    if (data.fabric) {
      const scene = JSON.parse(JSON.stringify(data.fabric));
      scene.objects = (scene.objects || []).filter(object => !["video", "youtube", "screen-share"].includes(object.mediaType));
      (scene.objects || []).forEach(object => { if (object.textBaseline === "alphabetical") object.textBaseline = "alphabetic"; });
      canvas.loadFromJSON(scene, () => {
        canvas.getObjects().forEach(object => { object.selectable = false; object.evented = false; });
        canvas.renderAll();
      });
    } else {
      (data.elements || []).filter(item => ["text", "textbox"].includes(item.type)).forEach(item => canvas.add(new fabric.Textbox(item.text || "", {
        left: (Number(item.x) || 0) * 12.8,
        top: (Number(item.y) || 0) * 7.2,
        width: (Number(item.width) || 40) * 12.8,
        fontSize: Number(item.fontSize) || 42,
        fontWeight: item.fontWeight || "500",
        fontStyle: item.fontStyle || "normal",
        fontFamily: item.fontFamily || "Arial",
        fill: item.color || "#171717",
        textAlign: item.textAlign || "left",
        selectable: false,
        evented: false
      })));
      canvas.renderAll();
    }
    mediaItems(slide).forEach(addMedia);
    const track = data.audio;
    if (track?.src) {
      const audio = document.createElement("audio");
      audio.src = track.src;
      audio.controls = true;
      audio.preload = "metadata";
      audio.setAttribute("aria-label", "Slide audio");
      audio.className = "share-viewer-audio";
      layer.append(audio);
    }
    byId("viewerCounter").textContent = `${index + 1} / ${presentation.slides.length}`;
    byId("viewerPrevious").disabled = index === 0;
    byId("viewerNext").disabled = index === presentation.slides.length - 1;
    transition(slide);
  }

  function go(delta) {
    const next = Math.max(0, Math.min(presentation.slides.length - 1, index + delta));
    if (next === index) return false;
    index = next;
    render();
    return true;
  }

  function setAutoplay(enabled) {
    autoplay = Boolean(enabled);
    window.clearInterval(autoplayTimer);
    const button = byId("viewerAutoplay");
    button.setAttribute("aria-pressed", String(autoplay));
    button.innerHTML = autoplay
      ? '<span aria-hidden="true">Ⅱ</span><span>Pause autoplay</span>'
      : '<span aria-hidden="true">▶</span><span>Autoplay</span>';
    if (!autoplay) return;
    const interval = Math.max(1000, Math.min(60000, Number(presentation.slides[0]?.canvas?.presentation_playback?.interval_ms) || 5000));
    autoplayTimer = window.setInterval(() => {
      const moved = go(1);
      if (!moved) setAutoplay(false);
    }, interval);
  }

  function showError(error) {
    message.hidden = false;
    message.textContent = error?.message || "This presentation link is invalid or unavailable.";
  }

  async function init() {
    let result;
    if (window.SnapKeyPresentationExport) result = { presentation: window.SnapKeyPresentationExport };
    else {
      if (!token || !window.PresentStudioApi) throw new Error("This presentation link is invalid or unavailable.");
      const access = await window.PresentStudioApi.resolveShareLink(token, { publicAccess: true });
      if (access.standaloneMeeting) throw new Error("This is a live meeting link, not a read-only presentation link.");
      result = await window.PresentStudioApi.getPresentation(access.presentationId, token, { publicAccess: true });
      if (result.permission !== "viewer") throw new Error("This link is not a read-only presentation link.");
    }
    presentation = result.presentation;
    if (!presentation?.slides?.length) throw new Error("This presentation does not contain any slides.");
    index = 0;
    document.title = `${presentation.title || "Shared presentation"} | SnapKey Studio`;
    canvas = new fabric.StaticCanvas("viewerCanvas", { width: 1280, height: 720, selection: false });
    message.hidden = true;
    controls.hidden = false;
    byId("viewerPrevious").addEventListener("click", () => go(-1));
    byId("viewerNext").addEventListener("click", () => go(1));
    byId("viewerAutoplay").addEventListener("click", () => setAutoplay(!autoplay));
    document.addEventListener("keydown", event => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === "ArrowLeft") { event.preventDefault(); go(-1); }
      if (event.key === "ArrowRight") { event.preventDefault(); go(1); }
      if (event.code === "Space" && !["VIDEO", "AUDIO", "IFRAME"].includes(document.activeElement?.tagName)) { event.preventDefault(); setAutoplay(!autoplay); }
    });
    render();
  }

  init().catch(showError);
})();
