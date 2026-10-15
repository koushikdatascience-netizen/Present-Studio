/* Optional consent-only assistance; no changes to LiveKit media transports. */
(function () {
  const labels = { requested: 'Waiting for Audience', pairing: 'Downloading / Opening Helper', paired: 'Waiting for Approval', active: 'Controlling', denied: 'Control Denied', ended: 'Control Ended' };
  function coordinates(rect, width, height, x, y) {
    const scale = Math.min(rect.width / width, rect.height / height);
    const w = width * scale, h = height * scale;
    const nx = (x - rect.left - (rect.width - w) / 2) / w;
    const ny = (y - rect.top - (rect.height - h) / 2) / h;
    return nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1 ? { x: nx, y: ny } : null;
  }
  function create(options) {
    const socket = options.socket;
    if (!socket) return null;
    let credential = '', role = '', current = null, seq = 0, panel = null, surface = null, binding = false;
    let pairingText = '';
    let frameUrl = '', pendingFrame = false, frameGeneration = 0, lastMove = 0;
    const buttons = new Set();
    const held = new Set();
    const api = async (path, body) => {
      const response = await fetch('/api/remote-control/' + path, {
        method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + credential, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}), cache: 'no-store'
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Remote assistance unavailable');
      return data;
    };
    function clearSurface() {
      frameGeneration++; held.clear();
      if (frameUrl) URL.revokeObjectURL(frameUrl);
      frameUrl = ''; surface = null;
    }
    function close() {
      clearSurface(); panel?.remove(); panel = null;
    }
    async function revoke() {
      const id = current?.id;
      close();
      if (id) await api('revoke', { sessionId: id }).catch(() => {});
    }
    function button(parent, text, action) {
      const el = document.createElement('button'); el.type = 'button'; el.textContent = text;
      el.onclick = () => Promise.resolve().then(action).catch(error => { if (status?.isConnected) status.textContent = error.message; else window.alert(error.message); });
      parent.append(el); return el;
    }
    let status;
    function input(packet) {
      if (current?.state !== 'active' || !socket.connected || !options.connected()) return;
      socket.emit('remote_control_input', { sessionId: current.id, seq: ++seq, input: packet }, result => {
        if (result?.error) { close(); current = null; }
      });
    }
    function render(data, force = false) {
      const previous = current;
      current = data;
      if (!force && previous?.id === data.id && previous.state === data.state) return;
      if (previous?.id !== data.id) pairingText = '';
      close();
      panel = document.createElement('section'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'SnapKey Remote Assist');
      Object.assign(panel.style, { position: 'fixed', inset: '8% 5%', zIndex: 10050, background: '#142033', color: 'white', padding: '20px', overflow: 'auto', border: '3px solid #63b7ff' });
      const title = document.createElement('h2'); title.textContent = 'Remote assistance';
      status = document.createElement('p'); status.setAttribute('aria-live', 'polite'); status.textContent = labels[data.state] || 'Connecting';
      panel.append(title, status); document.body.append(panel);
      if (['ended', 'denied', 'expired'].includes(data.state)) { button(panel, 'Close', close); return; }
      button(panel, 'Release / Stop Control', revoke);
      if (role === 'guest' && data.state === 'requested') {
        const explanation = document.createElement('p');
        explanation.textContent = data.ownerName + ' requests control of your Windows primary display. Viewing your screen does not grant control. Open the helper manually and approve there. You can stop at any time. Keep this meeting open.';
        panel.append(explanation);
        button(panel, 'Deny', () => api('deny', { sessionId: data.id }));
        button(panel, 'Prepare Helper Pairing', async () => {
          const paired = await api('ticket', { sessionId: data.id });
          const pairing = new URL(location.origin); pairing.hash = paired.ticket;
          pairingText = pairing.href;
          if (current?.id === data.id) render({ ...current, state: 'pairing' }, true);
        });
      }
      if (role === 'guest' && data.state === 'pairing') {
        const p = document.createElement('p'); p.textContent = 'Open SnapKey Remote Assist manually, paste this short-lived pairing text, then click Connect and Allow Control in its native window. Keep it private.';
        const text = document.createElement('input'); text.readOnly = true; text.value = pairingText; text.style.width = '95%'; text.onclick = () => text.select();
        panel.append(p, text);
        button(panel, 'Open Helper (if previously enabled)', () => {
          if (!pairingText) return;
          const pairing = new URL(pairingText);
          const launch = new URL('snapkey-remote-assist://pair');
          launch.searchParams.set('origin', pairing.origin);
          launch.searchParams.set('ticket', pairing.hash.slice(1));
          // User-initiated OS protocol action; normal browser confirmation applies.
          // Successful launch is never assumed: the UI waits for server pairing.
          window.location.href = launch.href;
        });

        button(panel, 'Download SnapKey Remote Assist', async () => {
          const response = await fetch('/api/remote-control/download', { headers: { Authorization: 'Bearer ' + credential } });
          if (!response.ok) throw new Error((await response.json()).detail);
          const url = URL.createObjectURL(await response.blob()); const a = document.createElement('a'); a.href = url; a.download = 'SnapKeyRemoteAssist.exe'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
        });
      }
      if (role === 'owner' && data.state === 'active') {
        seq = 0;
        const help = document.createElement('p'); help.textContent = 'Controlling the helper-approved primary display. Click the preview to focus. Escape releases control. Some Windows shortcuts are reserved; elevated windows cannot be controlled.';
        surface = document.createElement('img'); surface.alt = 'Approved remote primary display'; surface.tabIndex = 0; surface.draggable = false;
        Object.assign(surface.style, { width: '100%', height: '65vh', objectFit: 'contain', background: 'black', outline: '2px solid #63b7ff' });
        panel.append(help, surface);
        button(panel, 'Fullscreen', () => panel.requestFullscreen?.());
        surface.oncontextmenu = event => event.preventDefault();
        surface.onpointermove = event => {
          if (performance.now() - lastMove < 25) return;
          const pos = coordinates(surface.getBoundingClientRect(), surface.naturalWidth, surface.naturalHeight, event.clientX, event.clientY);
          if (pos) { lastMove = performance.now(); input({ kind: 'move', ...pos }); }
        };
        surface.onpointerdown = event => {
          if (![0, 2].includes(event.button)) return;
          const pos = coordinates(surface.getBoundingClientRect(), surface.naturalWidth, surface.naturalHeight, event.clientX, event.clientY);
          if (!pos) return;
          event.preventDefault(); surface.focus(); surface.setPointerCapture(event.pointerId);
          input({ kind: 'move', ...pos }); input({ kind: 'button', button: event.button === 0 ? 'left' : 'right', down: true });
        };
        surface.onpointerup = event => { if ([0, 2].includes(event.button)) input({ kind: 'button', button: event.button === 0 ? 'left' : 'right', down: false }); };
        surface.onpointercancel = revoke;
        surface.addEventListener('wheel', event => { event.preventDefault(); input({ kind: 'wheel', delta: event.deltaY > 0 ? -120 : 120 }); }, { passive: false });
        surface.onkeydown = event => {
          event.preventDefault();
          if (event.key === 'Escape') { revoke(); return; }
          const vk = virtualKey(event);
          if (vk && !held.has(vk)) { held.add(vk); input({ kind: 'key', vk, down: true }); }
        };
        surface.onkeyup = event => { event.preventDefault(); const vk = virtualKey(event); if (vk && held.delete(vk)) input({ kind: 'key', vk, down: false }); };
        surface.onblur = () => { for (const vk of held) input({ kind: 'key', vk, down: false }); held.clear(); input({ kind: 'button', button: 'left', down: false }); input({ kind: 'button', button: 'right', down: false }); };
      }
    }
    function virtualKey(event) {
      if (/^Key[A-Z]$/.test(event.code)) return event.code.charCodeAt(3);
      if (/^Digit[0-9]$/.test(event.code)) return event.code.charCodeAt(5);
      return { Backspace: 8, Tab: 9, Enter: 13, ShiftLeft: 16, ShiftRight: 16, ControlLeft: 17, ControlRight: 17, AltLeft: 18, AltRight: 18, Space: 32, PageUp: 33, PageDown: 34, End: 35, Home: 36, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Insert: 45, Delete: 46 }[event.code];
    }
    socket.on('remote_control_status', data => render(data));
    socket.on('remote_control_frame', data => {
      if (!surface || pendingFrame || data.sessionId !== current?.id || current.state !== 'active') return;
      pendingFrame = true;
      const generation = frameGeneration;
      const url = URL.createObjectURL(new Blob([data.jpeg], { type: 'image/jpeg' }));
      const image = new Image();
      image.onload = () => {
        pendingFrame = false;
        if (!surface || generation !== frameGeneration) { URL.revokeObjectURL(url); return; }
        if (frameUrl) URL.revokeObjectURL(frameUrl);
        frameUrl = url; surface.src = url;
      };
      image.onerror = () => { pendingFrame = false; URL.revokeObjectURL(url); };
      image.src = url;
    });
    socket.on('disconnect', () => { credential = ''; binding = false; current = null; close(); });
    const timer = setInterval(() => {
      for (const b of buttons) { if (!b.isConnected) buttons.delete(b); else b.hidden = role !== 'owner' || !credential; }
      if (!socket.connected || !options.connected()) {
        if (current) { revoke(); current = null; }
        return;
      }
      if (!credential && !binding) {
        binding = true;
        socket.emit('remote_control_bind', { presentationId: options.presentationId, authToken: options.authToken }, result => {
          binding = false;
          if (result?.credential) { credential = result.credential; role = result.role; }
          else if (result?.enabled === false) clearInterval(timer);
        });
      }
      if (credential) socket.emit('remote_control_heartbeat', { credential, sharing: options.sharing() });
    }, 500);
    window.addEventListener('pagehide', () => { clearInterval(timer); revoke(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && current?.state === 'active' && role === 'owner') revoke(); });
    return { addRequestButton(parent, identity) {
      const el = button(parent, 'Request Control', async () => {
        if (!credential || role !== 'owner') return;
        render(await api('request', { targetIdentity: identity }));
      });
      el.hidden = role !== 'owner' || !credential; buttons.add(el);
    } };
  }
  if (typeof window !== 'undefined') window.SnapKeyRemoteControl = { create, coordinates };
  if (typeof module !== 'undefined') module.exports = { coordinates };
})();
