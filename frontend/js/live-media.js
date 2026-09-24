(function () {
  "use strict";

  function create(options) {
    const root = options.root;
    if (!root) return null;
    const api = window.PresentStudioApi;
    const livekit = window.LivekitClient;
    const nameInput = root.querySelector("[data-live-name]");
    const screenCodeInput = root.querySelector("[data-screen-code]");
    const joinButton = root.querySelector("[data-live-join]");
    const microphoneButton = root.querySelector("[data-live-microphone]");
    const cameraButton = root.querySelector("[data-live-camera]");
    const screenShareButton = root.querySelector("[data-live-screen-share]");
    const backgroundButton = root.querySelector("[data-live-background]");
    const backgroundDialog = root.querySelector("[data-live-background-dialog]");
    const backgroundCloseButton = root.querySelector("[data-live-background-close]");
    const backgroundOptions = [...root.querySelectorAll("[data-live-background-option]")];
    const backgroundSupport = root.querySelector("[data-live-background-support]");
    const muteAllButton = root.querySelector("[data-live-mute-all]");
    const enableAudioButton = root.querySelector("[data-live-enable-audio]");
    const leaveButton = root.querySelector("[data-live-leave]");
    const panelToggle = root.querySelector("[data-live-panel-toggle]");
    const panelRestore = root.querySelector("[data-live-panel-restore]");
    const moreToggle = root.querySelector("[data-live-more-toggle]");
    const moreMenu = root.querySelector("[data-live-more-menu]");
    const restoreCount = root.querySelector("[data-live-restore-count]");
    const sheetHandle = root.querySelector("[data-live-sheet-handle]");
    const meetingSidebar = root.querySelector(".live-meeting-sidebar");
    const audienceControls = !options.controller && meetingSidebar?.querySelector(".audience-meeting-controls");
    let audienceFeedback = null;
    if (audienceControls) {
      // Keep personal media controls available while the mobile people sheet is closed.
      audienceFeedback = document.createElement("p");
      audienceFeedback.className = "audience-control-feedback";
      audienceFeedback.setAttribute("role", "status");
      meetingSidebar.after(audienceFeedback, audienceControls);
    }
    const fullscreenButton = root.querySelector("[data-live-fullscreen]");
    const fullscreenTarget = options.fullscreenTarget || null;
    const status = root.querySelector("[data-live-status]");
    const count = root.querySelector("[data-live-count]");
    const tiles = root.querySelector("[data-live-tiles]");
    const screenShareViewer = root.querySelector("[data-live-screen-share-viewer]");
    const screenShareMedia = root.querySelector("[data-live-screen-share-media]");
    const screenShareLabel = root.querySelector("[data-live-screen-share-label]");
    const screenShareMode = root.querySelector("[data-live-screen-share-mode]");
    const featuredCameraViewer = root.querySelector("[data-live-featured-camera-viewer]");
    const featuredCameraMedia = root.querySelector("[data-live-featured-camera-media]");
    const featuredCameraLabel = root.querySelector("[data-live-featured-camera-label]");
    const featuredCameraClose = root.querySelector("[data-live-featured-camera-close]");
    const presentationViewer = root.querySelector("[data-live-presentation-viewer]");
    const presentationCanvas = root.querySelector("[data-live-presentation-canvas]");
    const presentationMedia = root.querySelector("[data-live-presentation-media]");
    const presentationLabel = root.querySelector("[data-live-presentation-label]");
    const presentationEmpty = root.querySelector("[data-live-presentation-empty]");
    const handButton = root.querySelector("[data-live-hand]");
    const reactionButtons = [...root.querySelectorAll("[data-live-reaction]")];
    const sidebarTabs = [...root.querySelectorAll("[data-live-tab]")];
    const sidebarPanels = [...root.querySelectorAll("[data-live-panel]")];
    if (options.controller && meetingSidebar) {
      // Keep People, Chat, and reactions in the sidebar. The meeting-control dock
      // remains a direct child of the controller workspace so it stays at the bottom.
      meetingSidebar.append(...[
        root.querySelector(".live-sidebar-tabs"),
        root.querySelector(".live-sidebar-panels"),
        root.querySelector(".live-engagement-bar")
      ].filter(Boolean));
    }
    const peopleBadge = root.querySelector("[data-live-people-badge]");
    const chatBadge = root.querySelector("[data-live-chat-badge]");
    const chatMessages = root.querySelector("[data-live-chat-messages]");
    const chatEmpty = root.querySelector("[data-live-chat-empty]");
    const chatForm = root.querySelector("[data-live-chat-form]");
    const chatInput = root.querySelector("[data-live-chat-input]");
    const chatSubmit = chatForm?.querySelector("button[type='submit']");
    const chatAttachButton = root.querySelector("[data-live-chat-attach]");
    const chatFileInput = root.querySelector("[data-live-chat-file]");
    const lobby = root.querySelector("[data-live-lobby]");
    const waitingList = root.querySelector("[data-live-waiting-list]");
    const waitingCount = root.querySelector("[data-live-waiting-count]");
    const admitAllButton = root.querySelector("[data-live-admit-all]");
    const shareRequestHeading = root.querySelector("[data-live-share-heading]");
    const shareRequestList = root.querySelector("[data-live-share-list]");
    const shareRequestCount = root.querySelector("[data-live-share-count]");
    const approveSharesButton = root.querySelector("[data-live-approve-shares]");
    const presentationSource = options.presentationSource || {};
    const isController = options.controller === true;
    const isCohostController = isController && Boolean(options.cohostGuestId);
    const admissionBypass = isController || options.admissionBypass === true;
    let room = null;
    let microphoneEnabled = false;
    let cameraEnabled = false;
    let screenShareEnabled = false;
    let joining = false;
    let mountedTracks = new Set();
    let presentationMediaSignature = "";
    let screenShareRenderSignature = "";
    let participantRenderTimer = 0;
    let selectedShareIdentity = "";
    let controllerShareIdentity = "";
    let selectedCameraIdentity = "";
    let meetingMuted = false;
    let mutedParticipants = new Set();
    let audioPlaybackBlocked = false;
    let handRaised = false;
    let activeSidebarTab = "people";
    let unreadMessages = 0;
    let raisedHands = new Map();
    let soundContext = null;
    const reactionAudio = new Map();
    let reactionAudioWarmed = false;
    let joinSoundEnabled = localStorage.getItem("presentStudio.joinSoundEnabled") !== "false";
    let joinSoundButton = null;
    let tabSpeakerMuted = localStorage.getItem("presentStudio.tabSpeakerMuted") === "true";
    let tabSpeakerButton = null;
    let joinNotificationArmed = false;
    let admissionState = admissionBypass ? "approved" : "idle";
    let screenShareRequestPending = false;
    let screenShareApproved = false;
    let pendingScreenShareTracks = [];
    let participantRegistry = new Map();
    let backgroundProcessor = null;
    let backgroundProcessorTrack = null;
    let backgroundProcessorModule = null;
    let backgroundApplyQueue = Promise.resolve();
    let selectedBackground = localStorage.getItem("presentStudio.cameraBackground") || "none";
    if (!backgroundOptions.some(button => button.dataset.liveBackgroundOption === selectedBackground)) selectedBackground = "none";

    let desiredMicrophoneEnabled = false;
    let microphoneRecoveryInFlight = false;
    let wakeLockSentinel = null;
    let wakeLockWanted = false;
    let backgroundedAt = 0;
    let tabLeaseOwned = false;
    let tabLeaseHeartbeat = 0;
    let takeoverArmed = false;

    const meetingTabId = window.crypto?.randomUUID?.() || `tab-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const meetingLeaseRole = isController ? "controller" : "audience";
    const meetingLeaseKey = `presentStudio.meetingLease.${options.presentationId}.${meetingLeaseRole}`;
    const meetingLeaseTtlMs = 8000;
    const meetingTabChannel = typeof BroadcastChannel === "function"
      ? new BroadcastChannel(`presentStudio.meeting.${options.presentationId}.${meetingLeaseRole}`)
      : null;
    const isIOSLike = /iP(hone|ad|od)/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

    function stableMeetingClientId() {
      const key = isController ? "presentStudio.meetingControllerId" : "presentStudio.meetingGuestId";
      const prefix = isController ? "controller" : "guest";
      try {
        let value = localStorage.getItem(key);
        if (!value) {
          const raw = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
          value = `${prefix}-${raw}`.slice(0, 128);
          localStorage.setItem(key, value);
        }
        return String(value).slice(0, 128);
      } catch {
        const raw = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        return `${prefix}-${raw}`.slice(0, 128);
      }
    }

    const meetingClientId = stableMeetingClientId();

    const reactionMeta = {
      clap: { emoji: "👏", label: "applauded" },
      party: { emoji: "🥳", label: "celebrated" },
      heart: { emoji: "❤️", label: "sent some love" }
    };

    nameInput.value = options.displayName || "";
    const setStatus = (message, kind = "") => {
      status.textContent = message;
      status.dataset.kind = kind;
      if (audienceFeedback) {
        audienceFeedback.textContent = message;
        audienceFeedback.dataset.kind = kind;
      }
    };

    function readMeetingLease() {
      try {
        const raw = localStorage.getItem(meetingLeaseKey);
        return raw ? JSON.parse(raw) : null;
      } catch { return null; }
    }

    function writeMeetingLease() {
      if (!tabLeaseOwned) return;
      try {
        localStorage.setItem(meetingLeaseKey, JSON.stringify({ tabId: meetingTabId, updatedAt: Date.now() }));
      } catch {}
    }

    function startMeetingLeaseHeartbeat() {
      window.clearInterval(tabLeaseHeartbeat);
      writeMeetingLease();
      tabLeaseHeartbeat = window.setInterval(writeMeetingLease, 2500);
    }

    function releaseMeetingTab() {
      tabLeaseOwned = false;
      takeoverArmed = false;
      window.clearInterval(tabLeaseHeartbeat);
      tabLeaseHeartbeat = 0;
      try {
        const lease = readMeetingLease();
        if (lease?.tabId === meetingTabId) localStorage.removeItem(meetingLeaseKey);
      } catch {}
    }

    function claimMeetingTab() {
      if (tabLeaseOwned) return true;
      const lease = readMeetingLease();
      const occupied = Boolean(
        lease?.tabId &&
        lease.tabId !== meetingTabId &&
        Number(lease.updatedAt || 0) > Date.now() - meetingLeaseTtlMs
      );
      if (occupied && !takeoverArmed) {
        takeoverArmed = true;
        window.setTimeout(() => { takeoverArmed = false; }, 6000);
        setStatus("This meeting is already active in another tab. Select Join again to move it to this tab.", "error");
        return false;
      }
      if (occupied) {
        try { meetingTabChannel?.postMessage({ type: "takeover", tabId: meetingTabId, at: Date.now() }); } catch {}
      }
      tabLeaseOwned = true;
      takeoverArmed = false;
      startMeetingLeaseHeartbeat();
      return true;
    }

    async function handleMeetingTakenOver() {
      if (!tabLeaseOwned) return;
      tabLeaseOwned = false;
      window.clearInterval(tabLeaseHeartbeat);
      tabLeaseHeartbeat = 0;
      try { await leave({ requeue: true, releaseTab: false }); } catch {}
      if (!isController) admissionState = "idle";
      setStatus("This meeting moved to another tab. Select Join to move it back here.", "error");
      syncButtons(false);
    }

    meetingTabChannel?.addEventListener("message", event => {
      if (event.data?.type === "takeover" && event.data?.tabId !== meetingTabId) {
        handleMeetingTakenOver().catch(() => {});
      }
    });

    window.addEventListener("storage", event => {
      if (event.key !== meetingLeaseKey || !tabLeaseOwned || !event.newValue) return;
      try {
        const next = JSON.parse(event.newValue);
        if (next?.tabId && next.tabId !== meetingTabId) handleMeetingTakenOver().catch(() => {});
      } catch {}
    });

    async function requestMeetingWakeLock() {
      if (!wakeLockWanted || !room || document.visibilityState !== "visible" || wakeLockSentinel || !navigator.wakeLock?.request) return;
      try {
        wakeLockSentinel = await navigator.wakeLock.request("screen");
        root.dataset.wakeLock = "active";
        wakeLockSentinel.addEventListener("release", () => {
          wakeLockSentinel = null;
          root.dataset.wakeLock = "released";
        }, { once: true });
      } catch {
        wakeLockSentinel = null;
        root.dataset.wakeLock = "unavailable";
      }
    }

    async function releaseMeetingWakeLock() {
      wakeLockWanted = false;
      const sentinel = wakeLockSentinel;
      wakeLockSentinel = null;
      root.dataset.wakeLock = "off";
      if (sentinel) {
        try { await sentinel.release(); } catch {}
      }
    }
    function participantRole(participant) { try { return JSON.parse(participant.metadata || "{}").role || "viewer"; } catch { return "viewer"; } }
    function isPresenterParticipant(participant) {
      return participantRole(participant) === "presenter" || String(participant?.identity || "").startsWith("presenter-");
    }
    function nonPresenterRemoteIdentities() {
      if (!room) return [];
      return [...room.remoteParticipants.values()]
        .filter(participant => !isPresenterParticipant(participant))
        .map(participant => String(participant.identity || ""))
        .filter(Boolean);
    }
    function recomputeMeetingMuted() {
      const targets = nonPresenterRemoteIdentities();
      meetingMuted = targets.length > 0 && targets.every(identity => mutedParticipants.has(identity));
      return meetingMuted;
    }
    function publications(participant) { return participant?.trackPublications ? [...participant.trackPublications.values()] : []; }
    function isSource(publication, name) { return publication?.source === livekit.Track?.Source?.[name]; }
    function detachMountedTracks() { mountedTracks.forEach(track => track.detach?.()); mountedTracks.clear(); screenShareRenderSignature = ""; }
    function rememberAttachedTrack(track, element) {
      if (!track || !element) return;
      element._liveTrack = track;
      mountedTracks.add(track);
    }
    function detachNodeTracks(node) {
      node?.querySelectorAll("video, audio").forEach(element => {
        try { element._liveTrack?.detach?.(element); } catch {}
      });
    }
    function participantAudioMuted(identity) { return mutedParticipants.has(identity); }

    function currentIdentity() { return String(room?.localParticipant?.identity || ""); }
    function currentName() { return String(room?.localParticipant?.name || nameInput.value.trim() || (isController ? "Presenter" : "Guest")).slice(0, 80); }
    function moderationCredentials() {
      return {
        presentationId: options.presentationId,
        authToken: options.authToken || "",
        shareToken: options.shareToken || "",
        cohostGuestId: options.cohostGuestId || ""
      };
    }

    function registerController() {
      if (isController) options.socket?.emit("meeting_controller_register", moderationCredentials());
    }

    function updateParticipantRegistry(active) {
      const activeClientIds = new Set(active.map(item => String(item.clientId || "")).filter(Boolean));
      const connectedIdentities = new Set(
        room ? [...room.remoteParticipants.values()].map(participant => String(participant.identity || "")) : []
      );
      const nextRegistry = new Map(
        [...participantRegistry].filter(([identity, item]) =>
          activeClientIds.has(String(item.clientId || "")) || connectedIdentities.has(identity)
        )
      );
      active.forEach(item => {
        const clientId = String(item.clientId || "");
        const identity = String(item.identity || "");
        if (!clientId || !identity) return;
        [...nextRegistry].forEach(([knownIdentity, knownItem]) => {
          if (String(knownItem.clientId || "") === clientId && knownIdentity !== identity) nextRegistry.delete(knownIdentity);
        });
        nextRegistry.set(identity, item);
      });
      participantRegistry = nextRegistry;
    }

    function renderLobby(message) {
      if (!isController || !lobby || message?.presentationId !== options.presentationId) return;
      const pending = Array.isArray(message.pending) ? message.pending : [];
      const active = Array.isArray(message.active) ? message.active : [];
      const shareRequests = Array.isArray(message.screenShareRequests) ? message.screenShareRequests : [];
      updateParticipantRegistry(active);
      const peopleTab = sidebarTabs.find(button => button.dataset.liveTab === "people");
      peopleTab?.classList.toggle("has-pending", pending.length > 0 || shareRequests.length > 0);
      if (peopleTab) peopleTab.title = pending.length || shareRequests.length ? `${pending.length} waiting, ${shareRequests.length} screen share requests` : "";
      lobby.hidden = pending.length === 0 && shareRequests.length === 0;
      waitingCount.textContent = String(pending.length);
      admitAllButton.hidden = pending.length === 0;
      admitAllButton.onclick = () => options.socket?.emit("meeting_admission_decide", {
        ...moderationCredentials(), clientIds: pending.map(item => item.clientId), accepted: true
      });
      waitingList.replaceChildren(...pending.map(item => {
        const row = document.createElement("div");
        row.className = "live-lobby-person";
        const name = document.createElement("span");
        name.textContent = item.name || "Guest";
        const actions = document.createElement("div");
        const deny = document.createElement("button");
        deny.type = "button"; deny.textContent = "Deny"; deny.className = "is-secondary";
        deny.onclick = () => options.socket?.emit("meeting_admission_decide", { ...moderationCredentials(), clientId: item.clientId, accepted: false });
        const admit = document.createElement("button");
        admit.type = "button"; admit.textContent = "Admit";
        admit.onclick = () => options.socket?.emit("meeting_admission_decide", { ...moderationCredentials(), clientId: item.clientId, accepted: true });
        actions.append(deny, admit); row.append(name, actions); return row;
      }));
      shareRequestHeading.hidden = shareRequests.length === 0;
      approveSharesButton.hidden = shareRequests.length === 0;
      approveSharesButton.onclick = () => options.socket?.emit("meeting_screen_share_decide", {
        ...moderationCredentials(), clientIds: shareRequests.map(item => item.clientId), accepted: true
      });
      shareRequestCount.textContent = String(shareRequests.length);
      shareRequestList.replaceChildren(...shareRequests.map(item => {
        const row = document.createElement("div");
        row.className = "live-lobby-person";
        const name = document.createElement("span");
        name.textContent = item.name || "Guest";
        const actions = document.createElement("div");
        const deny = document.createElement("button");
        deny.type = "button"; deny.textContent = "Deny"; deny.className = "is-secondary";
        deny.onclick = () => options.socket?.emit("meeting_screen_share_decide", { ...moderationCredentials(), clientId: item.clientId, accepted: false });
        const allow = document.createElement("button");
        allow.type = "button"; allow.textContent = "Allow";
        allow.onclick = () => options.socket?.emit("meeting_screen_share_decide", { ...moderationCredentials(), clientId: item.clientId, accepted: true });
        actions.append(deny, allow); row.append(name, actions); return row;
      }));
      renderParticipants();
    }

    function setSidebarTab(tab) {
      activeSidebarTab = tab === "chat" ? "chat" : "people";
      sidebarTabs.forEach(button => {
        const active = button.dataset.liveTab === activeSidebarTab;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-selected", String(active));
      });
      sidebarPanels.forEach(panel => {
        const active = panel.dataset.livePanel === activeSidebarTab;
        panel.hidden = !active;
        panel.classList.toggle("is-active", active);
      });
      if (activeSidebarTab === "chat") {
        unreadMessages = 0;
        if (chatBadge) chatBadge.hidden = true;
        requestAnimationFrame(() => { if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight; });
      }
    }

    function appendLinkedText(container, value) {
      const text = String(value || "").slice(0, 500);
      const matcher = /https?:\/\/[^\s<]+/gi;
      let cursor = 0;
      for (const match of text.matchAll(matcher)) {
        if (match.index > cursor) container.append(document.createTextNode(text.slice(cursor, match.index)));
        const raw = match[0];
        const trailing = raw.match(/[),.!?:;]+$/)?.[0] || "";
        const href = trailing ? raw.slice(0, -trailing.length) : raw;
        const link = document.createElement("a");
        link.href = href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = href;
        link.className = "live-chat-link";
        container.append(link);
        if (trailing) container.append(document.createTextNode(trailing));
        cursor = match.index + raw.length;
      }
      if (cursor < text.length) container.append(document.createTextNode(text.slice(cursor)));
    }

    function renderChatAttachment(message, item) {
      const attachment = message?.attachment;
      if (!attachment?.url) return;
      const wrap = document.createElement("div");
      wrap.className = "live-chat-attachment";
      const mime = String(attachment.mimeType || "");
      if (mime.startsWith("image/")) {
        const image = document.createElement("img");
        image.src = attachment.url;
        image.alt = attachment.name || "Shared image";
        image.loading = "lazy";
        wrap.append(image);
      }
      const link = document.createElement("a");
      link.href = attachment.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.download = attachment.name || "";
      link.textContent = attachment.name || "Open attachment";
      wrap.append(link);
      item.append(wrap);
    }

    function appendChatMessage(message) {
      if (!chatMessages || (!message?.text && !message?.attachment?.url)) return;
      chatEmpty?.remove();
      const item = document.createElement("article");
      item.className = "live-chat-message";
      const own = message.identity && message.identity === currentIdentity();
      item.classList.toggle("is-own", Boolean(own));
      const heading = document.createElement("header");
      const author = document.createElement("strong");
      author.textContent = own ? "You" : String(message.name || "Guest").slice(0, 80);
      const time = document.createElement("time");
      const sentAt = new Date(Number(message.sentAt) || Date.now());
      time.dateTime = sentAt.toISOString();
      time.textContent = sentAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      heading.append(author, time);
      item.append(heading);
      if (message.text) {
        const body = document.createElement("p");
        appendLinkedText(body, message.text);
        item.append(body);
      }
      renderChatAttachment(message, item);
      chatMessages.append(item);
      while (chatMessages.children.length > 101) chatMessages.children[0].remove();
      chatMessages.scrollTop = chatMessages.scrollHeight;
      if (activeSidebarTab !== "chat" && !own) {
        unreadMessages += 1;
        if (chatBadge) { chatBadge.textContent = unreadMessages > 99 ? "99+" : String(unreadMessages); chatBadge.hidden = false; }
      }
    }

    function reactionLayer() {
      let layer = root.querySelector("[data-live-reaction-layer]");
      if (!layer) {
        layer = document.createElement("div");
        layer.className = "live-reaction-layer";
        layer.dataset.liveReactionLayer = "";
        layer.setAttribute("aria-live", "polite");
        root.append(layer);
      }
      return layer;
    }

    const reactionSoundUrls = {
      clap: "/assets/sounds/reaction-clap.mp3",
      party: "/assets/sounds/reaction-celebrate.mp3",
      heart: "/assets/sounds/reaction-love.mp3"
    };

    function reactionAudioElement(type) {
      let audio = reactionAudio.get(type);
      if (!audio) {
        const source = reactionSoundUrls[type];
        if (!source) return null;
        audio = new Audio(source);
        audio.preload = "auto";
        audio.volume = type === "clap" ? .58 : type === "party" ? .68 : .5;
        reactionAudio.set(type, audio);
      }
      return audio;
    }

    function playReactionSound(type) {
      try {
        const audio = reactionAudioElement(type);
        if (!audio) return;
        audio.pause();
        audio.currentTime = 0;
        audio.play().catch(error => console.warn(`Reaction audio failed for ${type}`, error));
      } catch (error) {
        console.warn(`Reaction audio failed for ${type}`, error);
      }
    }

    function warmReactionAudio() {
      if (reactionAudioWarmed) return;
      reactionAudioWarmed = true;
      Object.keys(reactionSoundUrls).forEach(type => {
        try {
          const audio = reactionAudioElement(type);
          if (!audio) return;
          audio.muted = true;
          const playback = audio.play();
          Promise.resolve(playback).then(() => {
            audio.pause();
            audio.currentTime = 0;
            audio.muted = false;
          }).catch(error => {
            audio.muted = false;
            console.warn(`Reaction audio warm-up failed for ${type}`, error);
          });
        } catch (error) {
          console.warn(`Reaction audio warm-up failed for ${type}`, error);
        }
      });
    }

    function unlockReactionAudio() {
      warmReactionAudio();
      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;
        soundContext ||= new AudioContextClass();
        soundContext.resume?.();
      } catch {}
    }

    async function playModerationAlert() {
      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;
        soundContext ||= new AudioContextClass();
        await soundContext.resume?.();
        const now = soundContext.currentTime;
        [880, 660].forEach((frequency, index) => {
          const oscillator = soundContext.createOscillator();
          const gain = soundContext.createGain();
          const start = now + index * .14;
          oscillator.type = "sine";
          oscillator.frequency.setValueAtTime(frequency, start);
          gain.gain.setValueAtTime(.0001, start);
          gain.gain.exponentialRampToValueAtTime(.12, start + .015);
          gain.gain.exponentialRampToValueAtTime(.0001, start + .12);
          oscillator.connect(gain);
          gain.connect(soundContext.destination);
          oscillator.start(start);
          oscillator.stop(start + .13);
        });
      } catch {}
    }

    function showModerationNotice(message) {
      if (audienceFeedback) {
        audienceFeedback.setAttribute("role", "alert");
        audienceFeedback.setAttribute("aria-live", "assertive");
      }
      setStatus(message, "attention");
      window.setTimeout(() => {
        if (!audienceFeedback) return;
        audienceFeedback.setAttribute("role", "status");
        audienceFeedback.setAttribute("aria-live", "polite");
      }, 1200);
    }

    function syncJoinSoundButton() {
      if (!joinSoundButton) return;
      joinSoundButton.setAttribute("aria-pressed", String(joinSoundEnabled));
      const labelNode = joinSoundButton.querySelector("[data-live-control-label]");
      if (labelNode) labelNode.textContent = joinSoundEnabled ? "Entry bell" : "Bell off";
      const title = joinSoundEnabled
        ? "Participant entry sound is on. Select to turn it off"
        : "Participant entry sound is off. Select to turn it on";
      joinSoundButton.setAttribute("aria-label", title);
      joinSoundButton.title = title;
    }

    function syncTabSpeakerButton() {
      if (!tabSpeakerButton) return;
      tabSpeakerButton.setAttribute("aria-pressed", String(tabSpeakerMuted));
      setControlLabel(
        tabSpeakerButton,
        tabSpeakerMuted ? "Speaker off" : "Speaker",
        tabSpeakerMuted ? "This tab's speaker is muted. Select to hear this tab" : "This tab's speaker is on. Select to mute only this tab"
      );
    }

    function ensureTabSpeakerControl() {
      if (tabSpeakerButton) return;
      const dock = root.querySelector(".live-media-actions");
      if (!dock) return;

      tabSpeakerButton = document.createElement("button");
      tabSpeakerButton.type = "button";
      tabSpeakerButton.className = "live-control-button is-tab-speaker";
      tabSpeakerButton.innerHTML =
        '<span class="live-control-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4zM15 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12"></path></svg></span>' +
        '<span data-live-control-label>Speaker</span>';

      const leaveControl = dock.querySelector("[data-live-leave]");
      if (joinSoundButton) dock.insertBefore(tabSpeakerButton, joinSoundButton);
      else if (leaveControl) dock.insertBefore(tabSpeakerButton, leaveControl);
      else dock.append(tabSpeakerButton);

      tabSpeakerButton.addEventListener("click", () => {
        tabSpeakerMuted = !tabSpeakerMuted;
        localStorage.setItem("presentStudio.tabSpeakerMuted", String(tabSpeakerMuted));
        applyRemoteAudioState();
        setStatus(tabSpeakerMuted ? "Speaker muted for this tab only" : "Speaker enabled for this tab", "success");
      });

      syncTabSpeakerButton();
    }

    function ensureJoinSoundControl() {
      if (joinSoundButton) return;
      const dock = root.querySelector(".live-media-actions");
      if (!dock) return;

      joinSoundButton = document.createElement("button");
      joinSoundButton.type = "button";
      joinSoundButton.className = "live-control-button is-join-sound";
      joinSoundButton.innerHTML =
        '<span class="live-control-icon" aria-hidden="true">🔔</span>' +
        '<span data-live-control-label>Entry bell</span>';

      const leaveControl = dock.querySelector("[data-live-leave]");
      if (leaveControl) dock.insertBefore(joinSoundButton, leaveControl);
      else dock.append(joinSoundButton);

      joinSoundButton.addEventListener("click", () => {
        unlockReactionAudio();
        joinSoundEnabled = !joinSoundEnabled;
        localStorage.setItem("presentStudio.joinSoundEnabled", String(joinSoundEnabled));
        syncJoinSoundButton();
        setStatus(
          joinSoundEnabled ? "Participant entry bell enabled" : "Participant entry bell off",
          "success"
        );
      });

      syncJoinSoundButton();
      ensureTabSpeakerControl();
    }

    function playParticipantJoinSound(participant) {
      if (!joinNotificationArmed || !joinSoundEnabled) return;
      if (participant?.identity === currentIdentity()) return;

      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;

        soundContext ||= new AudioContextClass();
        soundContext.resume?.();

        const now = soundContext.currentTime;

        [660, 880].forEach((frequency, index) => {
          const oscillator = soundContext.createOscillator();
          const gain = soundContext.createGain();

          oscillator.type = "sine";
          oscillator.frequency.setValueAtTime(frequency, now);

          const start = now + index * 0.13;
          gain.gain.setValueAtTime(0.0001, start);
          gain.gain.exponentialRampToValueAtTime(0.14, start + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.12);

          oscillator.connect(gain);
          gain.connect(soundContext.destination);

          oscillator.start(start);
          oscillator.stop(start + 0.13);
        });
      } catch {}
    }

    function showReaction(message) {
      const meta = reactionMeta[message?.reaction];
      if (!meta) return;
      const bubble = document.createElement("div");
      bubble.className = "live-reaction-bubble";
      bubble.innerHTML = `<span aria-hidden="true">${meta.emoji}</span><small></small>`;
      bubble.querySelector("small").textContent = `${String(message.name || "Someone").slice(0, 80)} ${meta.label}`;
      reactionLayer().append(bubble);
      playReactionSound(message.reaction);
      window.setTimeout(() => bubble.remove(), 3400);
    }

    async function applyParticipantAudioCommand(message) {
      if (!room || !message || message.presentationId !== options.presentationId) return;
      const target = String(message.targetIdentity || "");
      if (target === "*" && isController) return;
      if (target !== "*" && target !== currentIdentity()) return;
      const shouldMute = message.muted === true;
      microphoneButton.classList.toggle("is-unmute-requested", !shouldMute);
      await playModerationAlert();
      if (!shouldMute) {
        syncLocalPublishedState(); syncButtons(true);
        showModerationNotice("Presenter asked you to unmute. Select Unmute when you are ready.");
        return;
      }
      try {
        desiredMicrophoneEnabled = false;
        await room.localParticipant.setMicrophoneEnabled(false);
        syncLocalPublishedState(); syncButtons(true); renderParticipants();
        showModerationNotice("Presenter asked you to mute. Your microphone is now off.");
      } catch (error) {
        syncLocalPublishedState(); syncButtons(true);
        setStatus(error.message || "Microphone control failed", "error");
      }
    }

    function setControlLabel(button, label, accessibleLabel = label) {
      if (!button) return;
      const labelNode = button.querySelector("[data-live-control-label]");
      if (labelNode) labelNode.textContent = label;
      else button.textContent = label;
      button.setAttribute("aria-label", accessibleLabel);
      button.title = accessibleLabel;
    }

    function applyRemoteAudioState() {
      root.querySelectorAll("audio[data-live-audio-participant]").forEach(audio => {
        audio.muted = tabSpeakerMuted || participantAudioMuted(audio.dataset.liveAudioParticipant);
      });
      root.querySelectorAll("audio:not([data-live-audio-participant]), video").forEach(media => {
        if (tabSpeakerMuted) {
          if (!media.dataset.tabSpeakerPreviousMuted) media.dataset.tabSpeakerPreviousMuted = media.muted ? "1" : "0";
          media.muted = true;
        } else if (media.dataset.tabSpeakerPreviousMuted) {
          media.muted = media.dataset.tabSpeakerPreviousMuted === "1";
          delete media.dataset.tabSpeakerPreviousMuted;
        }
      });
      if (muteAllButton) {
        setControlLabel(muteAllButton, meetingMuted ? "Ask all" : "Mute all", meetingMuted ? "Everyone is muted. Select to ask everyone to unmute" : "Everyone can speak. Select to mute everyone");
        muteAllButton.setAttribute("aria-pressed", String(meetingMuted));
      }
      syncTabSpeakerButton();
    }

    function publishControllerState() {
      if (!isController || !options.socket) return;
      options.socket.emit("meeting_control", {
        presentationId: options.presentationId,
        authToken: options.authToken || "",
        shareToken: options.shareToken || "",
        featuredShareIdentity: controllerShareIdentity,
        meetingMuted,
        mutedParticipants: [...mutedParticipants]
      });
    }

    function applyControllerState(message) {
      if (!message || (message.presentationId && message.presentationId !== options.presentationId)) return;
      controllerShareIdentity = String(message.featuredShareIdentity || "");
      mutedParticipants = new Set(Array.isArray(message.mutedParticipants) ? message.mutedParticipants.map(String) : []);
      meetingMuted = Boolean(message.meetingMuted);
      if (room && nonPresenterRemoteIdentities().length) recomputeMeetingMuted();
      applyRemoteAudioState();
      renderParticipants();
    }

    function presentationSourceLabel() {
      const value = typeof presentationSource.label === "function" ? presentationSource.label() : presentationSource.label;
      return String(value || "Current presentation output");
    }

    function presentationVisualNodes() {
      return presentationSource.media ? [...presentationSource.media.children].filter(node => ["IMG", "VIDEO", "IFRAME"].includes(node.tagName) || node.matches?.("[data-slide-screen-share]")) : [];
    }

    function setScreenShareSlotEmpty(slot) {
      slot.classList.remove("is-live");
      slot.innerHTML = '<span aria-hidden="true">▣</span><strong>Live screen share</strong><small>Click here to select a screen</small>';
    }

    function startScreenShareFromSlide() {
      if (screenShareEnabled) return;
      if (!room) {
        setStatus("Join audio/video before sharing your screen", "error");
        joinButton.focus();
        return;
      }
      toggleScreenShare();
    }

    function syncPresentationMedia(sourceNodes) {
      if (!presentationMedia) return;
      const signature = sourceNodes.map(node => [node.tagName, node.currentSrc || node.src || "", node.className || "", node.getAttribute("style") || "", node.dataset.slideScreenShare || ""].join("|" )).join("::");
      if (signature !== presentationMediaSignature) {
        presentationMediaSignature = signature;
        const clones = sourceNodes.map(source => {
          const clone = source.cloneNode(false);
          clone.removeAttribute("controls");
          if (clone.tagName === "VIDEO") Object.assign(clone, { autoplay: true, muted: true, playsInline: true });
          if (clone.tagName === "IFRAME" && clone.dataset.youtubeId) clone.src = window.SnapKeyYouTube.embedUrl(clone.dataset.youtubeId);
          if (clone.matches?.("[data-slide-screen-share]")) {
            setScreenShareSlotEmpty(clone);
            if (admissionBypass) {
              clone.classList.add("can-start-screen-share");
              clone.tabIndex = 0;
              clone.setAttribute("role", "button");
              clone.setAttribute("aria-label", "Select a screen to share in this slide");
              clone.addEventListener("click", startScreenShareFromSlide);
              clone.addEventListener("keydown", event => {
                if (event.key === "Enter" || event.key === " ") { event.preventDefault(); startScreenShareFromSlide(); }
              });
            }
          }
          return clone;
        });
        detachNodeTracks(presentationMedia);
        presentationMedia.replaceChildren(...clones);
        screenShareRenderSignature = "";
        clones.filter(node => node.tagName === "IFRAME" && node.dataset.youtubeId).forEach(frame => window.SnapKeyYouTube.sync(frame, { muted: true, volume: 0 }));
        renderScreenShares();
      }
      const clones = [...presentationMedia.children];
      sourceNodes.forEach((source, index) => {
        const clone = clones[index];
        if (!clone || source.tagName !== "VIDEO") return;
        const sourceTime = Number(source.currentTime);
        if (Number.isFinite(sourceTime) && Math.abs(Number(clone.currentTime) - sourceTime) > .65) {
          try { clone.currentTime = sourceTime; } catch {}
        }
        if (source.paused || source.ended) clone.pause?.();
        else clone.play?.().catch(() => {});
      });
    }

    function syncPresentationViewer() {
      if (!presentationViewer || !presentationCanvas) return;
      const sourceCanvas = presentationSource.canvas;
      const sourceNodes = presentationVisualNodes();
      const canvasVisible = Boolean(sourceCanvas && !sourceCanvas.hidden);
      const context = presentationCanvas.getContext("2d");
      context.clearRect(0, 0, presentationCanvas.width, presentationCanvas.height);
      if (canvasVisible) {
        try { context.drawImage(sourceCanvas, 0, 0, presentationCanvas.width, presentationCanvas.height); } catch {}
      }
      syncPresentationMedia(sourceNodes);
      const hasVisual = canvasVisible || sourceNodes.length > 0;
      presentationViewer.classList.toggle("is-empty", !hasVisual);
      presentationCanvas.hidden = !canvasVisible;
      presentationEmpty.hidden = hasVisual;
      if (presentationLabel) presentationLabel.textContent = presentationSourceLabel();
    }

    const presentationSyncTimer = presentationViewer ? window.setInterval(syncPresentationViewer, 300) : 0;
    syncPresentationViewer();

    function syncLocalPublishedState() {
      microphoneEnabled = Boolean(room?.localParticipant?.isMicrophoneEnabled);
      cameraEnabled = Boolean(room?.localParticipant?.isCameraEnabled);
      screenShareEnabled = Boolean(room?.localParticipant?.isScreenShareEnabled);
    }

    function localMicrophonePublication() {
      return publications(room?.localParticipant).find(publication => isSource(publication, "Microphone")) || null;
    }

    function localMicrophoneHealth() {
      const publication = localMicrophonePublication();
      const track = publication?.track || null;
      const mediaTrack = track?.mediaStreamTrack || null;
      return {
        publication, track, mediaTrack,
        healthy: Boolean(
          desiredMicrophoneEnabled &&
          room?.localParticipant?.isMicrophoneEnabled &&
          publication &&
          !publication.isMuted &&
          mediaTrack &&
          mediaTrack.readyState === "live" &&
          mediaTrack.enabled !== false
        )
      };
    }

    async function recoverMicrophoneAfterBackground({ forceRestart = false } = {}) {
      if (!room || !desiredMicrophoneEnabled || microphoneRecoveryInFlight || document.visibilityState !== "visible") return false;
      const initial = localMicrophoneHealth();
      if (initial.healthy && !forceRestart) return true;
      microphoneRecoveryInFlight = true;
      try {
        if (initial.track?.restartTrack && (forceRestart || !initial.healthy)) {
          try { await initial.track.restartTrack(); } catch {}
        }
        let current = localMicrophoneHealth();
        if (!current.healthy) {
          await room.localParticipant.setMicrophoneEnabled(false).catch(() => {});
          await room.localParticipant.setMicrophoneEnabled(true);
          current = localMicrophoneHealth();
        }
        syncLocalPublishedState();
        syncButtons(true);
        renderParticipants();
        if (current.healthy) {
          setStatus("Microphone restored after device interruption", "success");
          return true;
        }
        setStatus("Microphone needs attention. Select the microphone button to restore it.", "error");
        return false;
      } catch (error) {
        syncLocalPublishedState();
        syncButtons(true);
        setStatus(error?.message || "Microphone could not be restored after the device interruption.", "error");
        return false;
      } finally {
        microphoneRecoveryInFlight = false;
      }
    }

    const backgroundPresets = {
      studio: "/assets/meeting-backgrounds/studio.svg",
      office: "/assets/meeting-backgrounds/office.svg",
      warm: "/assets/meeting-backgrounds/warm.svg",
      minimal: "/assets/meeting-backgrounds/minimal.svg",
      loft: "/assets/meeting-backgrounds/loft.svg",
      botanical: "/assets/meeting-backgrounds/botanical.svg",
      aurora: "/assets/meeting-backgrounds/aurora.svg",
      gallery: "/assets/meeting-backgrounds/gallery.svg"
    };

    function syncBackgroundOptions() {
      backgroundOptions.forEach(button => {
        const active = button.dataset.liveBackgroundOption === selectedBackground;
        button.classList.toggle("is-selected", active);
        button.setAttribute("aria-pressed", String(active));
      });
      backgroundButton?.classList.toggle("has-effect", selectedBackground !== "none");
      backgroundButton?.setAttribute("aria-pressed", String(selectedBackground !== "none"));
    }

    function localCameraTrack() {
      return publications(room?.localParticipant).find(publication => isSource(publication, "Camera") && publication.track && !publication.isMuted)?.track || null;
    }

    async function loadBackgroundProcessorModule() {
      if (backgroundProcessorModule) return backgroundProcessorModule;
      backgroundProcessorModule = await import("https://cdn.jsdelivr.net/npm/@livekit/track-processors@0.7.2/+esm");
      if (typeof backgroundProcessorModule.supportsBackgroundProcessors === "function" && !backgroundProcessorModule.supportsBackgroundProcessors()) {
        throw new Error("Camera backgrounds are not supported by this browser");
      }
      return backgroundProcessorModule;
    }

    async function applyCameraBackgroundNow(announce = false) {
      syncBackgroundOptions();
      const cameraTrack = localCameraTrack();
      if (!cameraTrack) {
        if (backgroundSupport) backgroundSupport.textContent = selectedBackground === "none" ? "No camera effect selected." : "Your effect will apply when you turn on the camera.";
        return;
      }
      try {
        if (backgroundSupport) backgroundSupport.textContent = selectedBackground === "none" ? "Removing camera effect…" : "Applying camera effect…";
        if (!backgroundProcessor || backgroundProcessorTrack !== cameraTrack) {
          const processors = await loadBackgroundProcessorModule();
          backgroundProcessor = processors.BackgroundProcessor({ mode: "disabled" });
          await cameraTrack.setProcessor(backgroundProcessor, true);
          backgroundProcessorTrack = cameraTrack;
        }
        if (selectedBackground === "none") await backgroundProcessor.switchTo({ mode: "disabled" });
        else if (selectedBackground === "blur" || selectedBackground === "blur-strong") await backgroundProcessor.switchTo({ mode: "background-blur", blurRadius: selectedBackground === "blur-strong" ? 22 : 12 });
        else await backgroundProcessor.switchTo({ mode: "virtual-background", imagePath: new URL(backgroundPresets[selectedBackground], location.origin).href });
        if (backgroundSupport) backgroundSupport.textContent = selectedBackground === "none" ? "Camera effect is off." : "Camera effect applied.";
        if (announce) setStatus(selectedBackground === "none" ? "Camera background removed" : "Camera background updated", "success");
      } catch (error) {
        backgroundProcessor = null;
        backgroundProcessorTrack = null;
        if (backgroundSupport) backgroundSupport.textContent = error.message || "This camera effect could not be applied.";
        if (announce) setStatus(error.message || "Camera background could not be applied", "error");
      }
    }

    function applySelectedCameraBackground(announce = false) {
      backgroundApplyQueue = backgroundApplyQueue.catch(() => {}).then(() => applyCameraBackgroundNow(announce));
      return backgroundApplyQueue;
    }

    function openBackgroundDialog() {
      syncBackgroundOptions();
      if (backgroundSupport) backgroundSupport.textContent = cameraEnabled ? "Choose an effect to preview it on your camera." : "Choose an effect now; it will apply when your camera starts.";
      backgroundButton?.setAttribute("aria-expanded", "true");
      if (typeof backgroundDialog?.showModal === "function") backgroundDialog.showModal();
      else backgroundDialog?.setAttribute("open", "");
    }

    function closeBackgroundDialog() {
      backgroundButton?.setAttribute("aria-expanded", "false");
      if (typeof backgroundDialog?.close === "function") backgroundDialog.close();
      else backgroundDialog?.removeAttribute("open");
      backgroundButton?.focus();
    }

    syncBackgroundOptions();

    function renderFeaturedCamera() {
      if (!featuredCameraViewer || !featuredCameraMedia) return;
      if (!selectedCameraIdentity || !room) {
        detachNodeTracks(featuredCameraMedia);
        featuredCameraMedia.replaceChildren();
        featuredCameraViewer.hidden = true;
        return;
      }
      const candidates = [room.localParticipant, ...room.remoteParticipants.values()];
      const participant = candidates.find(item => String(item.identity || "") === selectedCameraIdentity);
      const publication = participant && publications(participant).find(item => isSource(item, "Camera") && item.track && !item.isMuted);
      if (!participant || !publication?.track) {
        detachNodeTracks(featuredCameraMedia);
        featuredCameraMedia.replaceChildren();
        featuredCameraViewer.hidden = true;
        return;
      }
      const current = featuredCameraMedia.querySelector("video");
      const signature = String(participant.identity) + ":" + (publication.track.sid || publication.track.mediaStreamTrack?.id || "camera");
      if (featuredCameraMedia.dataset.signature !== signature || !current) {
        detachNodeTracks(featuredCameraMedia);
        featuredCameraMedia.replaceChildren();
        const video = publication.track.attach();
        Object.assign(video, { autoplay: true, playsInline: true, muted: participant === room.localParticipant });
        rememberAttachedTrack(publication.track, video);
        featuredCameraMedia.append(video);
        featuredCameraMedia.dataset.signature = signature;
      }
      if (featuredCameraLabel) featuredCameraLabel.textContent = (participant.name || "Guest") + " camera";
      featuredCameraViewer.hidden = false;
    }
    function addParticipantTile(participant, isLocal = false) {
      const tile = document.createElement("article");
      tile.className = "live-media-tile";
      tile.dataset.participantIdentity = participant.identity;
      const media = document.createElement("div");
      media.className = "live-media-tile-video";
      const videoPublication = publications(participant).find(publication => isSource(publication, "Camera") && publication.track && !publication.isMuted);
      if (videoPublication?.track) {
        const video = videoPublication.track.attach();
        Object.assign(video, { autoplay: true, playsInline: true, muted: isLocal });
        media.append(video);
        rememberAttachedTrack(videoPublication.track, video);
      } else {
        const avatar = document.createElement("span");
        avatar.className = "live-media-avatar";
        avatar.textContent = (participant.name || "Guest").trim().slice(0, 1).toUpperCase() || "G";
        media.append(avatar);
      }
      if (!isLocal) publications(participant).filter(publication => (isSource(publication, "Microphone") || isSource(publication, "ScreenShareAudio")) && publication.track).forEach(publication => {
        const audio = publication.track.attach();
        Object.assign(audio, { autoplay: true, hidden: true, muted: participantAudioMuted(participant.identity) });
        audio.dataset.liveAudioParticipant = participant.identity;
        tile.append(audio);
        rememberAttachedTrack(publication.track, audio);
        audio.play?.().catch(error => {
          if (error?.name !== "NotAllowedError") return;
          audioPlaybackBlocked = true;
          syncAudioRecovery();
          setStatus("Browser blocked meeting audio. Select Enable Audio.", "error");
        });
      });
      const caption = document.createElement("footer");
      const label = document.createElement("strong");
      label.textContent = `${participant.name || "Guest"}${isLocal ? " (You)" : ""}`;
      const state = document.createElement("span");
      const micOn = publications(participant).some(publication => isSource(publication, "Microphone") && !publication.isMuted);
      const micAudible = micOn && !mutedParticipants.has(participant.identity);
      state.textContent = `${participantRole(participant) === "presenter" ? "Presenter" : "Audience"} · ${micAudible ? "Mic on" : "Muted"}`;
      caption.append(label, state);
      const raised = raisedHands.get(participant.identity);
      if (raised) {
        const hand = document.createElement("span");
        hand.className = "live-raised-hand";
        hand.textContent = "✋ Hand raised";
        caption.append(hand);
        tile.classList.add("has-raised-hand");
      }
      if (isController && !isLocal) {
        const participantActions = document.createElement("div");
        participantActions.className = "live-participant-actions";
        const actionToggle = document.createElement("button");
        actionToggle.type = "button";
        actionToggle.className = "live-participant-action-toggle";
        actionToggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.8"></circle><circle cx="12" cy="12" r="1.8"></circle><circle cx="12" cy="19" r="1.8"></circle></svg>';
        actionToggle.setAttribute("aria-label", `Show actions for ${participant.name || "participant"}`);
        actionToggle.setAttribute("aria-expanded", "false");
        actionToggle.addEventListener("click", event => {
          event.stopPropagation();
          const open = !tile.classList.contains("is-actions-open");
          tile.classList.toggle("is-actions-open", open);
          actionToggle.setAttribute("aria-expanded", String(open));
        });
        caption.append(actionToggle);
        const mute = document.createElement("button");
        const muted = !micAudible;
        mute.type = "button";
        mute.className = "live-participant-mute";
        mute.innerHTML = muted
          ? '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"></rect><path d="M5 11a7 7 0 0 0 11.7 5.2M12 18v3M9 21h6M3 3l18 18"></path></svg>'
          : '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"></rect><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"></path></svg>';
        const presenterParticipant = isPresenterParticipant(participant);
        mute.disabled = presenterParticipant;
        const muteLabel = presenterParticipant
          ? "Presenters cannot be muted"
          : muted ? `Ask ${participant.name || "participant"} to unmute their microphone` : `Mute ${participant.name || "participant"}`;
        mute.setAttribute("aria-label", muteLabel);
        mute.title = muteLabel;
        mute.setAttribute("aria-pressed", String(muted));
        mute.addEventListener("click", event => {
          event.stopPropagation();
          if (presenterParticipant) return;
          if (muted) mutedParticipants.delete(participant.identity); else mutedParticipants.add(participant.identity);
          recomputeMeetingMuted();
          applyRemoteAudioState();
          renderParticipants();
          publishControllerState();
          options.socket?.emit("meeting_participant_audio", {
            presentationId: options.presentationId, authToken: options.authToken || "", shareToken: options.shareToken || "",
            targetIdentity: participant.identity, muted: !muted
          });
          setStatus(muted ? `Asked ${participant.name || "participant"} to unmute` : `Muted ${participant.name || "participant"}`, "success");
        });
        participantActions.append(mute);
        if (videoPublication?.track && !videoPublication.isMuted) {
          const feature = document.createElement("button");
          feature.type = "button";
          feature.className = "live-participant-feature";
          feature.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10v10H4zM14 10l6-3v10l-6-3z"></path></svg>';
          const featuring = selectedCameraIdentity === String(participant.identity);
          feature.setAttribute("aria-pressed", String(featuring));
          feature.setAttribute("aria-label", featuring ? "Stop featuring " + (participant.name || "participant") + " camera" : "Feature " + (participant.name || "participant") + " camera");
          feature.title = feature.getAttribute("aria-label");
          feature.addEventListener("click", event => {
            event.stopPropagation();
            selectedCameraIdentity = featuring ? "" : String(participant.identity);
            renderFeaturedCamera();
            renderParticipants();
          });
          participantActions.append(feature);
        }
        const registryItem = participantRegistry.get(String(participant.identity));
        if (registryItem?.clientId) {
          const roleButton = document.createElement("button");
          const cohost = registryItem.role === "cohost";
          roleButton.type = "button";
          roleButton.className = "meeting-v2-role-button" + (cohost ? " is-cohost" : "");
          roleButton.innerHTML = cohost
            ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M12 5v14"></path></svg>'
            : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 15 9l6 .9-4.5 4.4 1.1 6.2L12 17.5 6.4 20.5l1.1-6.2L3 9.9 9 9z"></path></svg>';
          const roleLabel = isCohostController
            ? "Only the presentation owner can change participant roles"
            : cohost ? `Make ${participant.name || "participant"} a normal audience member` : `Make ${participant.name || "participant"} co-host`;
          roleButton.disabled = isCohostController;
          roleButton.setAttribute("aria-label", roleLabel);
          roleButton.title = roleLabel;
          roleButton.addEventListener("click", event => {
            event.stopPropagation();
            if (isCohostController) return;
            options.socket?.emit("meeting_role_update", {
              ...moderationCredentials(),
              clientId: registryItem.clientId,
              role: cohost ? "audience" : "cohost"
            });
            setStatus(cohost ? `Returning ${participant.name || "participant"} to audience…` : `Promoting ${participant.name || "participant"} to co-host…`);
          });
          participantActions.append(roleButton);

          const remove = document.createElement("button");
          remove.type = "button";
          remove.className = "live-participant-remove";
          remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"></circle><path d="M3.5 19c.3-3 2.2-5 5.5-5s5.2 2 5.5 5M16 9l5 5m0-5-5 5"></path></svg>';
          const removeLabel = isCohostController
            ? "Only the presentation owner can remove participants"
            : `Move ${participant.name || "participant"} to the waiting room`;
          remove.disabled = isCohostController;
          remove.setAttribute("aria-label", removeLabel);
          remove.title = removeLabel;
          remove.addEventListener("click", event => {
            event.stopPropagation();
            if (isCohostController) return;
            options.socket?.emit("meeting_remove_participant", { ...moderationCredentials(), clientId: registryItem.clientId });
          });
          participantActions.append(remove);
        }
        caption.append(participantActions);
      }
      tile.append(media, caption);
      return tile;
    }

    function renderScreenShares() {
      const embeddedSlots = presentationMedia ? [...presentationMedia.querySelectorAll("[data-slide-screen-share]")] : [];
      if (!room) {
        detachNodeTracks(screenShareMedia);
        screenShareMedia.replaceChildren();
        embeddedSlots.forEach(setScreenShareSlotEmpty);
        screenShareRenderSignature = "";
        screenShareViewer.hidden = true;
        root.classList.remove("has-screen-share");
        return;
      }
      const sharers = [room.localParticipant, ...room.remoteParticipants.values()];
      const activeShares = [];
      sharers.forEach(participant => publications(participant)
        .filter(publication => isSource(publication, "ScreenShare") && publication.track && !publication.isMuted)
        .forEach(publication => activeShares.push({ participant, track: publication.track })));
      const availableIdentities = new Set(activeShares.map(item => item.participant.identity));
      if (isController && controllerShareIdentity && !availableIdentities.has(controllerShareIdentity)) {
        controllerShareIdentity = "";
        publishControllerState();
      }
      const controllerOverrideActive = availableIdentities.has(controllerShareIdentity);
      const requestedIdentity = controllerShareIdentity || selectedShareIdentity;
      const featuredIdentity = availableIdentities.has(requestedIdentity) ? requestedIdentity : (activeShares[0]?.participant.identity || "");
      if (!availableIdentities.has(selectedShareIdentity)) selectedShareIdentity = featuredIdentity;
      const embeddedSignature = embeddedSlots.map(slot => slot.dataset.slideScreenShare || "slot").join("|");
      const renderSignature = `${activeShares.map(({ participant, track }) => `${participant.identity}:${track.sid || track.mediaStreamTrack?.id || "share"}`).join("|")}::${featuredIdentity}::${controllerShareIdentity}::${embeddedSignature}`;
      const visible = activeShares.length > 0;
      const embedded = embeddedSlots.length > 0;
      screenShareViewer.hidden = !visible || embedded;
      root.classList.toggle("has-screen-share", visible && !embedded);
      screenShareMedia.classList.toggle("has-multiple", activeShares.length > 1);
      if (visible) screenShareLabel.textContent = activeShares.length === 1 ? `${activeShares[0].participant.name || "Guest"} is sharing` : `${activeShares.length} shared screens`;
      if (screenShareMode) screenShareMode.textContent = controllerOverrideActive
        ? "Controller-selected screen"
        : activeShares.length > 1 ? (isController ? "Choose the screen shown to everyone" : "Select a screen to focus") : "";
      if (renderSignature === screenShareRenderSignature) return;
      screenShareRenderSignature = renderSignature;
      detachNodeTracks(screenShareMedia);
      screenShareMedia.replaceChildren();
      embeddedSlots.forEach(slot => {
        detachNodeTracks(slot);
        const featured = activeShares.find(item => item.participant.identity === featuredIdentity);
        if (!featured) { setScreenShareSlotEmpty(slot); return; }
        slot.replaceChildren();
        slot.classList.add("is-live");
        const video = featured.track.attach();
        Object.assign(video, { autoplay: true, playsInline: true, muted: featured.participant === room.localParticipant });
        rememberAttachedTrack(featured.track, video);
        const label = document.createElement("span");
        label.className = "slide-screen-share-label";
        label.textContent = `${featured.participant.name || "Guest"}${featured.participant === room.localParticipant ? " (You)" : ""}`;
        slot.append(video, label);
        if (isController && activeShares.length > 1) {
          const picker = document.createElement("div");
          picker.className = "slide-screen-share-picker";
          activeShares.forEach(({ participant }) => {
            const select = document.createElement("button");
            select.type = "button";
            select.textContent = participant.name || "Guest";
            select.disabled = participant.identity === featuredIdentity;
            select.addEventListener("click", event => {
              event.stopPropagation();
              selectedShareIdentity = participant.identity;
              controllerShareIdentity = participant.identity;
              publishControllerState();
              renderParticipants();
            });
            picker.append(select);
          });
          slot.append(picker);
        }
      });
      if (embedded) return;
      const gallery = document.createElement("div");
      gallery.className = "live-screen-share-gallery";
      gallery.setAttribute("aria-label", "Other shared screens");
      activeShares.forEach(({ participant, track }) => {
        const figure = document.createElement("figure");
        figure.dataset.participantIdentity = participant.identity;
        figure.classList.toggle("is-featured", participant.identity === featuredIdentity);
        const video = track.attach();
        Object.assign(video, { autoplay: true, playsInline: true, muted: participant === room.localParticipant });
        rememberAttachedTrack(track, video);
        const caption = document.createElement("figcaption");
        caption.textContent = `${participant.name || "Guest"}${participant === room.localParticipant ? " (You)" : ""}`;
        const actions = document.createElement("div");
        actions.className = "live-screen-share-actions";
        if (activeShares.length > 1) {
          const select = document.createElement("button");
          select.type = "button";
          const controllerLocked = controllerOverrideActive && !isController;
          const selectLabel = participant.identity === featuredIdentity ? `${participant.name || "Guest"}'s screen is showing` : controllerLocked ? "The controller has selected another screen" : (isController ? `Show ${participant.name || "Guest"}'s screen to everyone` : `Focus ${participant.name || "Guest"}'s screen`);
          select.textContent = participant.identity === featuredIdentity ? "●" : controllerLocked ? "🔒" : "◎";
          select.setAttribute("aria-label", selectLabel);
          select.title = selectLabel;
          select.disabled = participant.identity === featuredIdentity || controllerLocked;
          select.addEventListener("click", () => {
            selectedShareIdentity = participant.identity;
            if (isController) {
              controllerShareIdentity = participant.identity;
              publishControllerState();
            }
            renderParticipants();
          });
          actions.append(select);
        }
        const fullscreen = document.createElement("button");
        fullscreen.type = "button";
        fullscreen.textContent = "⛶";
        fullscreen.setAttribute("aria-label", `View ${participant.name || "Guest"}'s screen fullscreen`);
        fullscreen.title = fullscreen.getAttribute("aria-label");
        fullscreen.addEventListener("click", () => figure.requestFullscreen?.().catch(() => {}));
        actions.append(fullscreen);
        if (isController && participant !== room.localParticipant) {
          const revoke = document.createElement("button");
          revoke.type = "button";
          revoke.className = "is-danger";
          revoke.textContent = "×";
          revoke.setAttribute("aria-label", `Stop ${participant.name || "Guest"}'s screen share`);
          revoke.title = revoke.getAttribute("aria-label");
          revoke.addEventListener("click", () => options.socket?.emit("meeting_screen_share_revoke", {
            ...moderationCredentials(), targetIdentity: participant.identity
          }));
          actions.append(revoke);
        }
        figure.append(video, caption, actions);
        if (participant.identity === featuredIdentity) screenShareMedia.append(figure);
        else gallery.append(figure);
      });
      if (gallery.childElementCount) screenShareMedia.append(gallery);
    }

    function participantRenderSignature(participant, isLocal) {
      const publicationState = publications(participant).map(publication => [
        publication.trackSid || publication.sid || publication.track?.sid || publication.track?.mediaStreamTrack?.id || "track",
        publication.source || "",
        publication.isMuted ? "muted" : "live",
        publication.track ? "attached" : "pending"
      ].join(":")).sort().join("|");
      const registryItem = participantRegistry.get(String(participant.identity));
      return [participant.identity, participant.name, participant.metadata, isLocal, publicationState,
        raisedHands.has(participant.identity), meetingMuted, mutedParticipants.has(participant.identity), registryItem?.clientId || ""].join("::");
    }

    function renderParticipants() {
      if (!room) { count.textContent = "0 connected"; if (restoreCount) restoreCount.textContent = "0"; return; }
      if (isController && mutedParticipants.size) {
        const connectedIdentities = new Set([room.localParticipant.identity, ...[...room.remoteParticipants.values()].map(participant => participant.identity)]);
        const activeMuted = new Set([...mutedParticipants].filter(identity => connectedIdentities.has(identity)));
        if (activeMuted.size !== mutedParticipants.size) {
          mutedParticipants = activeMuted;
          publishControllerState();
        }
      }
      const participants = [{ participant: room.localParticipant, isLocal: true }, ...[...room.remoteParticipants.values()].map(participant => ({ participant, isLocal: false }))];
      const existingTiles = new Map([...tiles.querySelectorAll("[data-participant-identity]")].map(tile => [tile.dataset.participantIdentity, tile]));
      const activeIdentities = new Set();
      participants.forEach(({ participant, isLocal }, index) => {
        const identity = String(participant.identity);
        const signature = participantRenderSignature(participant, isLocal);
        let tile = existingTiles.get(identity);
        if (!tile || tile.dataset.renderSignature !== signature) {
          const replacement = addParticipantTile(participant, isLocal);
          replacement.dataset.renderSignature = signature;
          if (tile) { detachNodeTracks(tile); tile.replaceWith(replacement); }
          else tiles.append(replacement);
          tile = replacement;
        }
        const currentAtIndex = tiles.children[index];
        if (currentAtIndex !== tile) tiles.insertBefore(tile, currentAtIndex || null);
        activeIdentities.add(identity);
      });
      existingTiles.forEach((tile, identity) => {
        if (activeIdentities.has(identity)) return;
        detachNodeTracks(tile);
        tile.remove();
      });
      renderScreenShares();
      const total = room.remoteParticipants.size + 1;
      count.textContent = `${total} connected`;
      if (peopleBadge) peopleBadge.textContent = String(total);
      if (restoreCount) restoreCount.textContent = String(total);
      renderFeaturedCamera();
      options.onParticipantTilesRendered?.();
    }

    function scheduleParticipantRender() {
      if (participantRenderTimer) return;
      participantRenderTimer = window.setTimeout(() => {
        participantRenderTimer = 0;
        renderParticipants();
      }, 60);
    }

    function highlightSpeakers(speakers) {
      const active = new Set((speakers || []).map(participant => participant.identity));
      tiles.querySelectorAll("[data-participant-identity]").forEach(tile => tile.classList.toggle("is-speaking", active.has(tile.dataset.participantIdentity)));
    }

    function syncButtons(connected) {
      root.classList.toggle("is-connected", connected);
      if (!connected) setAudienceSidebarHidden(false);
      joinButton.hidden = connected;
      joinButton.disabled = joining || (!isController && admissionState === "waiting");
      joinButton.textContent = !isController && admissionState === "waiting" ? "Waiting for presenter…" : (isController ? "Join audio/video" : "Ask to join meeting");
      nameInput.disabled = connected || joining || (!isController && admissionState === "waiting");
      microphoneButton.disabled = !connected;
      cameraButton.disabled = !connected;
      screenShareButton.disabled = !connected;
      if (backgroundButton) backgroundButton.disabled = !connected;
      if (muteAllButton) {
        muteAllButton.disabled = !connected;
        muteAllButton.title = isCohostController ? "Co-hosts can mute audience participants; owner and co-host microphones are protected" : "";
      }
      if (handButton) handButton.disabled = !connected;
      reactionButtons.forEach(button => { button.disabled = !connected; });
      if (chatInput) chatInput.disabled = !connected;
      if (chatSubmit) chatSubmit.disabled = !connected;
      if (chatAttachButton) chatAttachButton.disabled = !connected;
      leaveButton.disabled = !connected;
      setControlLabel(microphoneButton, isController ? (microphoneEnabled ? "Mic on" : "Mic off") : (microphoneEnabled ? "Mute" : "Unmute"), microphoneEnabled ? "Microphone is on. Select to mute" : "Microphone is off. Select to unmute");
      setControlLabel(cameraButton, cameraEnabled ? "Camera off" : "Camera on", cameraEnabled ? "Turn camera off" : "Turn camera on");
      if (screenShareEnabled) setControlLabel(screenShareButton, "Stop share", "Stop sharing your screen");
      else if (screenShareRequestPending) setControlLabel(screenShareButton, "Pending", "Screen share request pending");
      else if (screenShareApproved) setControlLabel(screenShareButton, "Start share", "Start approved screen share");
      else setControlLabel(screenShareButton, "Share", isController ? "Share screen" : "Request screen share");
      screenShareButton.disabled = !connected || screenShareRequestPending;
      microphoneButton.setAttribute("aria-pressed", String(microphoneEnabled));
      cameraButton.setAttribute("aria-pressed", String(cameraEnabled));
      screenShareButton.setAttribute("aria-pressed", String(screenShareEnabled));
      applyRemoteAudioState();
    }

    function setAudienceSidebarHidden(hidden, moveFocus = false) {
      const collapsed = Boolean(hidden);
      root.classList.toggle("is-sidebar-hidden", collapsed);
      if (meetingSidebar) {
        meetingSidebar.inert = collapsed;
        meetingSidebar.setAttribute("aria-hidden", String(collapsed));
      }
      if (panelToggle) {
        panelToggle.setAttribute("aria-expanded", String(!collapsed));
        panelToggle.setAttribute("aria-label", collapsed ? "Show people panel" : "Hide people panel");
        panelToggle.title = panelToggle.getAttribute("aria-label");
      }
      if (panelRestore) panelRestore.hidden = !collapsed;
      root.querySelectorAll("[data-live-more-action='panel']").forEach(button => { button.textContent = collapsed ? "Show panel" : "Hide panel"; });
      if (moveFocus) (collapsed ? panelRestore : panelToggle)?.focus();
    }

    function setMoreMenuOpen(open) {
      if (!moreToggle || !moreMenu) return;
      moreMenu.hidden = !open;
      moreToggle.setAttribute("aria-expanded", String(open));
    }

    function activateMoreAction(action) {
      if (action === "panel") panelToggle?.click();
      else if (action === "fullscreen") fullscreenButton?.click();
      else if (action === "settings") {
        const settingsTarget = root.querySelector("[data-live-settings-target]")?.dataset.liveSettingsTarget || "";
        if (settingsTarget) document.querySelector(settingsTarget)?.click();
      }
      setMoreMenuOpen(false);
    }

    function syncAudioRecovery() {
      enableAudioButton.hidden = !room || (!audioPlaybackBlocked && room.canPlayAudio !== false);
    }

    async function enableAudio(showSuccess = true) {
      if (!room) return false;
      try {
        let presentationAudioReady = true;
        try { presentationAudioReady = (await options.onEnableAudio?.()) !== false; } catch { presentationAudioReady = false; }
        await room.startAudio();
        const audioResults = await Promise.allSettled([...root.querySelectorAll("audio[data-live-audio-participant]")].map(audio => audio.play()));
        audioPlaybackBlocked = !presentationAudioReady || audioResults.some(result => result.status === "rejected");
        syncAudioRecovery();
        const ready = !audioPlaybackBlocked && room.canPlayAudio !== false;
        if (showSuccess) setStatus(ready ? "Audio enabled" : "Audio is still blocked. Check this tab's sound permission.", ready ? "success" : "error");
        return ready;
      } catch (error) {
        enableAudioButton.hidden = false;
        setStatus(error.message || "Browser blocked audio. Select Enable Audio.", "error");
        return false;
      }
    }

    function bindRoomEvents() {
      const events = livekit.RoomEvent;
      [events.ParticipantDisconnected, events.TrackSubscribed, events.TrackUnsubscribed,
        events.TrackPublished, events.TrackUnpublished, events.TrackMuted, events.TrackUnmuted]
        .filter(Boolean).forEach(eventName => room.on(eventName, scheduleParticipantRender));

      if (events.ParticipantConnected) {
        room.on(events.ParticipantConnected, participant => {
          scheduleParticipantRender();
          playParticipantJoinSound(participant);
        });
      }
      room.on(events.LocalTrackPublished, publication => {
        syncLocalPublishedState();
        if (isSource(publication, "Microphone") && desiredMicrophoneEnabled) {
          const mediaTrack = publication?.track?.mediaStreamTrack;
          mediaTrack?.addEventListener?.("ended", () => {
            if (desiredMicrophoneEnabled && document.visibilityState === "visible") recoverMicrophoneAfterBackground().catch(() => {});
          }, { once: true });
        }
        syncButtons(true);
        scheduleParticipantRender();
      });
      room.on(events.LocalTrackUnpublished, publication => {
        const stoppedScreenShare = isSource(publication, "ScreenShare") || isSource(publication, "ScreenShareAudio");
        if (isSource(publication, "Camera")) { backgroundProcessor = null; backgroundProcessorTrack = null; }
        syncLocalPublishedState(); syncButtons(true); scheduleParticipantRender();
        if (stoppedScreenShare && !screenShareEnabled) setStatus("Screen sharing stopped");
      });
      room.on(events.ActiveSpeakersChanged, highlightSpeakers);
      if (events.AudioPlaybackStatusChanged) room.on(events.AudioPlaybackStatusChanged, syncAudioRecovery);
      if (events.MediaDevicesError) {
        room.on(events.MediaDevicesError, error => {
          const micError = room?.localParticipant?.lastMicrophoneError;
          if (desiredMicrophoneEnabled && (micError || /microphone|audio|device/i.test(error?.message || ""))) {
            setStatus(micError?.message || error?.message || "Microphone device is unavailable.", "error");
          }
        });
      }
      room.on(events.Reconnecting, () => setStatus("Reconnecting…"));
      room.on(events.Reconnected, () => {
        announceParticipantIdentity({ refreshAdmission: true });
        syncLocalPublishedState();
        syncButtons(true);
        renderParticipants();
        syncAudioRecovery();
        requestMeetingWakeLock().catch(() => {});
        recoverMicrophoneAfterBackground().catch(() => {});
        setStatus("Connected", "success");
      });
      room.on(events.Disconnected, () => {
        stopPendingScreenShare();
        joinNotificationArmed = false;
        microphoneEnabled = false; cameraEnabled = false; screenShareEnabled = false; audioPlaybackBlocked = false; detachMountedTracks(); room = null;
        wakeLockWanted = false;
        releaseMeetingWakeLock().catch(() => {});
        backgroundProcessor = null; backgroundProcessorTrack = null;
        tiles.replaceChildren(); screenShareMedia.replaceChildren(); screenShareViewer.hidden = true; enableAudioButton.hidden = true;
        root.classList.remove("has-screen-share"); count.textContent = "0 connected"; setStatus("Left the live room"); syncButtons(false);
      });
    }

    let admissionValidating = false;
    async function requestAdmission() {
      if (joining || room || admissionState === "waiting" || admissionValidating) return;
      const name = nameInput.value.trim();
      if (!name) { setStatus("Enter your name before asking to join", "error"); nameInput.focus(); return; }
      admissionValidating = true;
      joinButton.disabled = true;
      try { await options.onValidateAdmission?.(); }
      catch (error) { setStatus(error.message || "Check your meeting access code and try again.", "error"); return; }
      finally { admissionValidating = false; if (admissionState !== "waiting") joinButton.disabled = false; }
      if (!claimMeetingTab()) return;
      admissionState = "waiting";
      setStatus("Waiting for the presenter to admit you…");
      syncButtons(false);
      emitAdmissionRequest();
    }

    function emitAdmissionRequest() {
      options.socket?.emit("meeting_admission_request", {
        presentationId: options.presentationId, clientId: meetingClientId, name: nameInput.value.trim()
      });
    }

    function announceParticipantIdentity({ refreshAdmission = false } = {}) {
      if ((isController && !isCohostController) || !room?.localParticipant?.identity) return;
      if (refreshAdmission && !isCohostController) emitAdmissionRequest();
      options.socket?.emit("meeting_participant_joined", {
        presentationId: options.presentationId,
        clientId: isCohostController ? options.cohostGuestId : meetingClientId,
        identity: room.localParticipant.identity,
        name: currentName()
      });
    }

    async function join(approved = false) {
      if (!admissionBypass && approved !== true) { requestAdmission(); return; }
      if (joining || room) return;
      if (!tabLeaseOwned && !claimMeetingTab()) return;
      if (!livekit?.Room) { releaseMeetingTab(); setStatus("Audio/video library could not be loaded", "error"); return; }
      if (!api?.getLiveMediaToken) { setStatus("This page is out of date. Refresh it and try again.", "error"); return; }
      // Run presentation audio playback directly inside the user gesture. This
      // also unlocks the document's audio playback before the async room join.
      try { options.onEnableAudio?.(); } catch {}
      unlockReactionAudio();
      if (options.fullscreenTarget && options.fullscreenOnJoin !== false && !document.fullscreenElement) options.fullscreenTarget.requestFullscreen?.().catch(() => {});
      joining = true; joinButton.disabled = true; nameInput.disabled = true; setStatus("Joining…");
      try {
        room = new livekit.Room({ adaptiveStream: true, dynacast: true });
        bindRoomEvents();
        // startAudio must run while the click's user activation is still valid.
        // Keep the promise and check it again after the asynchronous room connect.
        let audioUnlock = Promise.resolve(false);
        try { audioUnlock = Promise.resolve(room.startAudio()).then(() => true).catch(() => false); } catch {}
        const credentials = await api.getLiveMediaToken(options.presentationId, {
          displayName: nameInput.value.trim(), shareToken: options.shareToken || "", screenAccessCode: options.getScreenAccessCode?.() || options.screenAccessCode || undefined,
          clientId: meetingClientId
        }, options.requestOptions || {});
        await room.connect(credentials.url, credentials.token, { autoSubscribe: true });
        const gestureUnlocked = await audioUnlock;
        const connectedAudioReady = await enableAudio(false);
        const audioReady = connectedAudioReady || (gestureUnlocked && !audioPlaybackBlocked && room.canPlayAudio !== false);
        admissionState = "approved";
        wakeLockWanted = true;
        requestMeetingWakeLock().catch(() => {});
        announceParticipantIdentity({ refreshAdmission: true });
        setStatus(audioReady ? `Connected as ${credentials.participantName}` : `Connected as ${credentials.participantName} · audio needs permission`, audioReady ? "success" : "error");
        syncButtons(true); renderParticipants();
        joinNotificationArmed = true;
        if (!isController) setAudienceSidebarHidden(false);
      } catch (error) {
        room?.disconnect(); room = null;
        wakeLockWanted = false;
        releaseMeetingWakeLock().catch(() => {});
        releaseMeetingTab();
        if (!isController) admissionState = "idle";
        setStatus(error.message || "Could not join audio/video", "error"); syncButtons(false);
      } finally {
        joining = false; syncButtons(Boolean(room));
      }
    }

    async function toggleMicrophone() {
      if (!room) return;
      microphoneButton.classList.remove("is-unmute-requested");
      microphoneButton.disabled = true;
      const nextMicrophoneState = !microphoneEnabled;
      try {
        await room.localParticipant.setMicrophoneEnabled(nextMicrophoneState);
        desiredMicrophoneEnabled = nextMicrophoneState;
        syncLocalPublishedState(); syncButtons(true); renderParticipants();
      } catch (error) {
        if (nextMicrophoneState) desiredMicrophoneEnabled = false;
        syncLocalPublishedState(); setStatus(error.message || "Microphone permission was not granted", "error"); syncButtons(true);
      }
    }

    async function toggleCamera() {
      if (!room) return;
      cameraButton.disabled = true;
      try {
        await room.localParticipant.setCameraEnabled(!cameraEnabled);
        syncLocalPublishedState();
        if (cameraEnabled && selectedBackground !== "none") await applySelectedCameraBackground(false);
        syncButtons(true); renderParticipants();
      }
      catch (error) { syncLocalPublishedState(); setStatus(error.message || "Camera permission was not granted", "error"); syncButtons(true); }
    }

    async function toggleScreenShare() {
      if (!room) return;
      const enable = !screenShareEnabled;
      if (enable && typeof navigator.mediaDevices?.getDisplayMedia !== "function") {
        setStatus("This browser cannot capture your screen. You can share your camera here, or use a desktop browser to share a screen.", "error");
        return;
      }
      if (enable && !admissionBypass && !screenShareApproved) {
        const activeRoom = room;
        screenShareRequestPending = true;
        setStatus("Choose the screen, window or tab you want to share…");
        syncButtons(true);
        try {
          pendingScreenShareTracks = await activeRoom.localParticipant.createScreenTracks();
          if (room !== activeRoom) {
            stopPendingScreenShare();
            return;
          }
          if (!pendingScreenShareTracks.length) throw new Error("No screen was selected");
          setStatus("Waiting for the presenter to allow screen sharing…");
          options.socket?.emit("meeting_screen_share_request", {
            presentationId: options.presentationId, clientId: meetingClientId,
            identity: currentIdentity(), name: currentName()
          });
        } catch (error) {
          stopPendingScreenShare();
          const cancelled = error?.name === "NotAllowedError" || /cancel|permission|denied/i.test(error?.message || "");
          setStatus(cancelled ? "Screen sharing was cancelled or blocked by browser permission" : (error.message || "Screen sharing could not start"), "error");
          syncButtons(true);
        }
        return;
      }
      if (enable) screenShareApproved = false;
      screenShareButton.disabled = true;
      try {
        await room.localParticipant.setScreenShareEnabled(enable);
        screenShareRequestPending = false;
        syncLocalPublishedState(); syncButtons(true); renderParticipants();
        setStatus(screenShareEnabled ? "Screen sharing started" : "Screen sharing stopped", "success");
      } catch (error) {
        screenShareRequestPending = false;
        syncLocalPublishedState(); syncButtons(true);
        const cancelled = error?.name === "NotAllowedError" || /cancel|permission|denied/i.test(error?.message || "");
        setStatus(cancelled ? "Screen sharing was cancelled or blocked by browser permission" : (error.message || "Screen sharing could not start"), "error");
      }
    }

    async function publishApprovedScreenShare() {
      const activeRoom = room;
      const tracks = pendingScreenShareTracks;
      pendingScreenShareTracks = [];
      screenShareApproved = false;
      if (!activeRoom || !tracks.length) {
        setStatus("Screen sharing approval expired. Select Share to choose a screen again.", "error");
        syncButtons(Boolean(activeRoom));
        return;
      }
      screenShareButton.disabled = true;
      const published = [];
      try {
        for (const track of tracks) {
          await activeRoom.localParticipant.publishTrack(track);
          published.push(track);
        }
        syncLocalPublishedState(); syncButtons(true); renderParticipants();
        setStatus("Screen sharing started", "success");
      } catch (error) {
        await Promise.allSettled(published.map(track => activeRoom.localParticipant.unpublishTrack(track, true)));
        tracks.filter(track => !published.includes(track)).forEach(track => { try { track.stop(); } catch {} });
        syncLocalPublishedState(); syncButtons(true);
        setStatus(error.message || "Screen sharing could not start", "error");
      }
    }

    function stopPendingScreenShare() {
      pendingScreenShareTracks.forEach(track => { try { track.stop(); } catch {} });
      pendingScreenShareTracks = [];
      screenShareRequestPending = false;
      screenShareApproved = false;
    }

    async function leave({ requeue = false, releaseTab = null } = {}) {
      const shouldReleaseTab = releaseTab === null ? !requeue : Boolean(releaseTab);
      const activeRoom = room;
      if (!activeRoom) {
        desiredMicrophoneEnabled = false;
        if (shouldReleaseTab) releaseMeetingTab();
        await releaseMeetingWakeLock();
        return;
      }
      stopPendingScreenShare();
      if (!isController && !requeue) options.socket?.emit("meeting_participant_left", { presentationId: options.presentationId, clientId: meetingClientId });
      if (handRaised) options.socket?.emit("meeting_hand", { presentationId: options.presentationId, identity: currentIdentity(), name: currentName(), raised: false });
      await Promise.allSettled([
        activeRoom.localParticipant.setMicrophoneEnabled(false),
        activeRoom.localParticipant.setCameraEnabled(false),
        activeRoom.localParticipant.setScreenShareEnabled(false)
      ]);
      desiredMicrophoneEnabled = false;
      wakeLockWanted = false;
      await releaseMeetingWakeLock();
      if (shouldReleaseTab) releaseMeetingTab();
      detachMountedTracks();
      activeRoom.disconnect();
    }

    async function recoverMeetingAfterBackground() {
      if (!room || document.visibilityState !== "visible") return;

      const awayMs = backgroundedAt ? Date.now() - backgroundedAt : 0;
      wakeLockWanted = true;
      requestMeetingWakeLock().catch(() => {});

      try {
        await room.startAudio();
        const audioResults = await Promise.allSettled(
          [...root.querySelectorAll("audio[data-live-audio-participant]")].map(audio => audio.play())
        );
        audioPlaybackBlocked = audioResults.some(result => result.status === "rejected") || room?.canPlayAudio === false;
      } catch {
        audioPlaybackBlocked = room?.canPlayAudio === false;
      }

      await recoverMicrophoneAfterBackground({
        forceRestart: Boolean(isIOSLike && awayMs > 1200 && desiredMicrophoneEnabled)
      });
      syncLocalPublishedState();
      syncButtons(true);
      renderParticipants();
      syncAudioRecovery();

      if (backgroundedAt) {
        backgroundedAt = 0;
        if (awayMs > 1500 && !audioPlaybackBlocked && (!desiredMicrophoneEnabled || localMicrophoneHealth().healthy)) {
          setStatus("Meeting restored after device interruption", "success");
        }
      }
    }

    joinButton.addEventListener("click", event => {
      unlockReactionAudio();
      join(event);
    });
    function submitJoinOnEnter(event) {
      if (event.key !== "Enter" || event.isComposing) return;
      event.preventDefault();
      joinButton.click();
    }
    nameInput.addEventListener("keydown", submitJoinOnEnter);
    if (!isController) screenCodeInput?.addEventListener("keydown", submitJoinOnEnter);
    microphoneButton.addEventListener("click", toggleMicrophone);
    cameraButton.addEventListener("click", toggleCamera);
    screenShareButton.addEventListener("click", toggleScreenShare);
    backgroundButton?.addEventListener("click", openBackgroundDialog);
    backgroundCloseButton?.addEventListener("click", closeBackgroundDialog);
    backgroundDialog?.addEventListener("close", () => backgroundButton?.setAttribute("aria-expanded", "false"));
    backgroundDialog?.addEventListener("click", event => { if (event.target === backgroundDialog) closeBackgroundDialog(); });
    backgroundOptions.forEach(button => button.addEventListener("click", async () => {
      selectedBackground = button.dataset.liveBackgroundOption || "none";
      localStorage.setItem("presentStudio.cameraBackground", selectedBackground);
      syncBackgroundOptions();
      await applySelectedCameraBackground(true);
    }));
    muteAllButton?.addEventListener("click", () => {
      if (!room) return;
      const targets = nonPresenterRemoteIdentities();
      const allMuted = targets.length > 0 && targets.every(identity => mutedParticipants.has(identity));
      targets.forEach(identity => {
        if (allMuted) mutedParticipants.delete(identity);
        else mutedParticipants.add(identity);
        options.socket?.emit("meeting_participant_audio", {
          ...moderationCredentials(),
          targetIdentity: identity,
          muted: !allMuted
        });
      });
      recomputeMeetingMuted();
      applyRemoteAudioState();
      publishControllerState();
      renderParticipants();
      setStatus(allMuted ? "Asked all audience participants to unmute" : "Muted all audience participants; presenters stay unmuted", "success");
    });
    handButton?.addEventListener("click", () => {
      if (!room) return;
      handRaised = !handRaised;
      handButton.setAttribute("aria-pressed", String(handRaised));
      handButton.lastElementChild.textContent = handRaised ? "Lower hand" : "Raise hand";
      options.socket?.emit("meeting_hand", { presentationId: options.presentationId, identity: currentIdentity(), name: currentName(), raised: handRaised });
    });
    reactionButtons.forEach(button => button.addEventListener("click", () => {
      if (!room) return;
      unlockReactionAudio();
      options.socket?.emit("meeting_reaction", { presentationId: options.presentationId, identity: currentIdentity(), name: currentName(), reaction: button.dataset.liveReaction });
    }));
    sidebarTabs.forEach(button => button.addEventListener("click", () => setSidebarTab(button.dataset.liveTab)));
    async function uploadMeetingAttachment(file) {
      if (!room || !file) return;
      if (file.size > 100 * 1024 * 1024) {
        setStatus("Chat files must be 100 MB or smaller", "error");
        return;
      }
      const form = new FormData();
      form.append("presentation_id", options.presentationId);
      form.append("client_id", meetingClientId);
      form.append("share_token", options.shareToken || "");
      form.append("file", file, file.name || "attachment");
      chatAttachButton && (chatAttachButton.disabled = true);
      setStatus(`Uploading ${file.name || "attachment"}…`);
      try {
        const headers = {};
        if (options.authToken) headers.Authorization = `Bearer ${options.authToken}`;
        const response = await fetch("/api/media/meeting-upload", { method: "POST", headers, body: form });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.detail || "File upload failed");
        options.socket?.emit("meeting_chat", {
          presentationId: options.presentationId,
          identity: currentIdentity(),
          name: currentName(),
          text: "",
          attachment: payload.attachment
        });
        setSidebarTab("chat");
        setStatus("File shared", "success");
      } catch (error) {
        setStatus(error.message || "File upload failed", "error");
      } finally {
        if (chatFileInput) chatFileInput.value = "";
        if (chatAttachButton) chatAttachButton.disabled = !room;
      }
    }

    chatForm?.addEventListener("submit", event => {
      event.preventDefault();
      const text = chatInput.value.trim();
      if (!room || !text) return;
      options.socket?.emit("meeting_chat", { presentationId: options.presentationId, identity: currentIdentity(), name: currentName(), text });
      chatInput.value = "";
      chatInput.focus();
    });
    chatAttachButton?.addEventListener("click", () => chatFileInput?.click());
    chatFileInput?.addEventListener("change", () => {
      const file = chatFileInput.files?.[0];
      if (file) uploadMeetingAttachment(file);
    });
    chatInput?.addEventListener("paste", event => {
      const file = [...(event.clipboardData?.files || [])].find(item => item.type?.startsWith("image/"));
      if (!file) return;
      event.preventDefault();
      uploadMeetingAttachment(file);
    });
    chatMessages?.addEventListener("dragover", event => {
      if (!room || !event.dataTransfer?.types?.includes("Files")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      chatMessages.classList.add("is-file-dragover");
    });
    chatMessages?.addEventListener("dragleave", () => chatMessages.classList.remove("is-file-dragover"));
    chatMessages?.addEventListener("drop", event => {
      chatMessages.classList.remove("is-file-dragover");
      const file = event.dataTransfer?.files?.[0];
      if (!room || !file) return;
      event.preventDefault();
      uploadMeetingAttachment(file);
    });
    enableAudioButton.addEventListener("click", () => enableAudio(true));
    leaveButton.addEventListener("click", leave);
    fullscreenButton?.addEventListener("click", async () => {
      if (!fullscreenTarget) return;
      if (document.fullscreenElement === fullscreenTarget) {
        await document.exitFullscreen?.().catch(() => {});
        return;
      }
      if (document.fullscreenElement) await document.exitFullscreen?.().catch(() => {});
      const requestFullscreen = fullscreenTarget.requestFullscreen || fullscreenTarget.webkitRequestFullscreen;
      if (!requestFullscreen) {
        setStatus("Fullscreen is not supported by this browser", "error");
        return;
      }
      try { await requestFullscreen.call(fullscreenTarget); }
      catch (error) { setStatus(error.message || "Fullscreen was blocked", "error"); }
    });
    document.addEventListener("fullscreenchange", () => {
      if (!fullscreenButton) return;
      const active = document.fullscreenElement === fullscreenTarget;
      fullscreenButton.textContent = active ? "×" : "⛶";
      fullscreenButton.setAttribute("aria-label", active ? "Exit presentation fullscreen" : "Enter presentation fullscreen");
      fullscreenButton.title = active ? "Exit fullscreen" : "Enter fullscreen";
    });
    featuredCameraClose?.addEventListener("click", () => {
      selectedCameraIdentity = "";
      renderFeaturedCamera();
      renderParticipants();
    });
    panelToggle?.addEventListener("click", () => setAudienceSidebarHidden(true, true));
    panelRestore?.addEventListener("click", () => setAudienceSidebarHidden(false, true));
    moreToggle?.addEventListener("click", event => {
      event.stopPropagation();
      setMoreMenuOpen(moreMenu?.hidden !== false);
    });
    moreMenu?.addEventListener("click", event => {
      const button = event.target.closest("[data-live-more-action]");
      if (button) activateMoreAction(button.dataset.liveMoreAction);
    });
    document.addEventListener("click", event => {
      if (moreMenu?.hidden !== false || moreMenu.contains(event.target) || moreToggle?.contains(event.target)) return;
      setMoreMenuOpen(false);
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape") setMoreMenuOpen(false);
    });
    if (sheetHandle && !isController) {
      let startY = null;
      sheetHandle.addEventListener("pointerdown", event => {
        startY = event.clientY;
        sheetHandle.setPointerCapture?.(event.pointerId);
      });
      sheetHandle.addEventListener("pointerup", event => {
        if (startY === null) return;
        const distance = event.clientY - startY;
        startY = null;
        if (distance > 36) setAudienceSidebarHidden(true, true);
        else if (distance < -36) setAudienceSidebarHidden(false, true);
        else setAudienceSidebarHidden(!root.classList.contains("is-sidebar-hidden"), true);
      });
      sheetHandle.addEventListener("pointercancel", () => { startY = null; });
      sheetHandle.addEventListener("click", event => {
        if (event.detail === 0) setAudienceSidebarHidden(!root.classList.contains("is-sidebar-hidden"), true);
      });
      sheetHandle.addEventListener("keydown", event => {
        if (event.key === "ArrowDown") { event.preventDefault(); setAudienceSidebarHidden(true, true); }
        if (event.key === "ArrowUp") { event.preventDefault(); setAudienceSidebarHidden(false, true); }
      });
    }
    options.socket?.on("meeting_control_state", applyControllerState);
    options.socket?.on("meeting_participant_audio_command", applyParticipantAudioCommand);
    options.socket?.on("meeting_chat_message", message => { if (message?.presentationId === options.presentationId) appendChatMessage(message); });
    options.socket?.on("meeting_reaction_event", message => { if (message?.presentationId === options.presentationId) showReaction(message); });
    options.socket?.on("meeting_hand_state", message => {
      if (message?.presentationId !== options.presentationId || !message.identity) return;
      if (message.raised) raisedHands.set(String(message.identity), String(message.name || "Guest")); else raisedHands.delete(String(message.identity));
      renderParticipants();
    });
    options.socket?.on("meeting_lobby_state", renderLobby);
    options.socket?.on("meeting_role_changed", message => {
      if (message?.presentationId !== options.presentationId || message.clientId !== meetingClientId) return;
      if (message.role === "cohost" && message.controllerUrl && !isController) {
        try { sessionStorage.setItem(`presentStudio.cohostReturn.${options.presentationId}`, location.href); } catch {}
        setStatus("You have been promoted to co-host. Opening presenter controls…", "success");
        window.setTimeout(() => location.replace(message.controllerUrl), 450);
        return;
      }
      if (message.role === "audience" && isController && options.cohostGuestId === message.clientId) {
        const returnKey = `presentStudio.cohostReturn.${options.presentationId}`;
        let returnUrl = "";
        try { returnUrl = sessionStorage.getItem(returnKey) || ""; sessionStorage.removeItem(returnKey); } catch {}
        setStatus("Co-host access ended. Returning to the audience view…");
        window.setTimeout(() => location.replace(returnUrl || `/present.html?id=${encodeURIComponent(options.presentationId)}`), 450);
      }
    });
    options.socket?.on("meeting_controller_revoked", message => {
      if (!isController || !options.cohostGuestId || message?.presentationId !== options.presentationId || message.clientId !== options.cohostGuestId) return;
      const returnKey = `presentStudio.cohostReturn.${options.presentationId}`;
      let returnUrl = "";
      try { returnUrl = sessionStorage.getItem(returnKey) || ""; sessionStorage.removeItem(returnKey); } catch {}
      setStatus(message.reason === "demoted" ? "You are now an audience participant." : "Your co-host access has ended.");
      window.setTimeout(() => location.replace(returnUrl || `/present.html?id=${encodeURIComponent(options.presentationId)}`), 450);
    });
    options.socket?.on("connect", () => announceParticipantIdentity({ refreshAdmission: true }));
    options.socket?.on("meeting_admission_decision", message => {
      if (isController || message?.presentationId !== options.presentationId || message.clientId !== meetingClientId) return;
      if (message.accepted) {
        admissionState = "approved";
        setStatus("The presenter admitted you. Joining…", "success");
        join(true);
      } else {
        admissionState = "idle";
        releaseMeetingTab();
        setStatus("The presenter did not admit this request. You can ask again.", "error");
        syncButtons(false);
      }
    });
    options.socket?.on("meeting_removed_by_controller", async message => {
      if (isController || message?.presentationId !== options.presentationId || message.clientId !== meetingClientId) return;
      admissionState = "waiting";
      screenShareRequestPending = false;
      screenShareApproved = false;
      await leave({ requeue: true });
      setStatus("The presenter moved you to the waiting room.");
      syncButtons(false);
    });
    options.socket?.on("meeting_screen_share_decision", async message => {
      if (isController || message?.presentationId !== options.presentationId || message.clientId !== meetingClientId) return;
      screenShareRequestPending = false;
      if (message.accepted) {
        screenShareApproved = true;
        setStatus("Screen sharing approved. Starting now…", "success");
        await publishApprovedScreenShare();
      } else {
        stopPendingScreenShare();
        setStatus("The presenter declined the screen sharing request.", "error");
        syncButtons(true);
      }
    });
    options.socket?.on("meeting_screen_share_revoke_command", async message => {
      if (!room || message?.presentationId !== options.presentationId || message.targetIdentity !== currentIdentity()) return;
      screenShareApproved = false;
      if (room.localParticipant.isScreenShareEnabled) await room.localParticipant.setScreenShareEnabled(false).catch(() => {});
      syncLocalPublishedState(); syncButtons(true); renderParticipants();
      setStatus("The presenter stopped your screen share.");
    });
    options.socket?.on("connect", () => {
      if (isController) registerController();
      else if (admissionState === "waiting") emitAdmissionRequest();
    });
    if (options.socket?.connected) registerController();

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        backgroundedAt = Date.now();
        return;
      }
      recoverMeetingAfterBackground().catch(() => {});
    });

    window.addEventListener("pageshow", () => {
      recoverMeetingAfterBackground().catch(() => {});
    });
    window.addEventListener("focus", () => {
      recoverMeetingAfterBackground().catch(() => {});
    });
    window.addEventListener("online", () => {
      recoverMeetingAfterBackground().catch(() => {});
    });
    window.addEventListener("beforeunload", () => {
      releaseMeetingTab();
      try { meetingTabChannel?.close(); } catch {}
    });

    if (isController) ensureJoinSoundControl();
    ensureTabSpeakerControl();
    syncButtons(false);
    setSidebarTab("people");
    function getLocalMicrophoneMediaTrack() {
      return localMicrophonePublication()?.track?.mediaStreamTrack || null;
    }

    return { join, leave, getLocalMicrophoneMediaTrack };
  }

  window.SnapKeyLiveMedia = { create };
})();
