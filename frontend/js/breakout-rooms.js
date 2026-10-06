(function () {
  "use strict";
  function mount(options, hooks) {
    const root = options.root;
    const tabs = root.querySelector(".live-sidebar-tabs");
    const panels = root.querySelector(".live-sidebar-panels");
    if (!tabs || !panels || !options.socket) return null;
    function element(tag, text, className) {
      const node = document.createElement(tag);
      if (text) node.textContent = text;
      if (className) node.className = className;
      return node;
    }
    function button(text, callback) {
      const node = element("button", text);
      node.type = "button";
      node.addEventListener("click", callback);
      return node;
    }
    const tab = button("Rooms", () => {});
    tab.dataset.liveTab = "rooms";
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", "false");
    tabs.append(tab);
    const panel = element("section", "", "live-sidebar-panel breakout-panel");
    panel.dataset.livePanel = "rooms";
    panel.setAttribute("aria-label", "Meeting rooms");
    panel.hidden = true;
    panels.append(panel);
    const message = element("p", "Join the meeting to access rooms.", "breakout-status");
    message.setAttribute("role", "status");
    const controls = element("div", "", "breakout-controls");
    const list = element("div", "", "breakout-room-list");
    panel.append(message, controls, list);
    const menu = root.querySelector("[data-live-more-menu]");
    if (menu) {
      const shortcut = button("Manage rooms", () => hooks.open());
      shortcut.setAttribute("role", "menuitem");
      menu.append(shortcut);
    }
    let resumeToken = options.resumeToken || "";
    try { resumeToken ||= sessionStorage.getItem(`presentStudio.breakoutCredential.${options.presentationId}`) || ""; } catch {}
    let state = null;
    let busy = false;
    let transferring = false;
    const selected = new Set();
    let activeDialog = null;
    function ask({title, message: detail, label, value = "", limit = 80, accept = "Confirm"}) {
      if (activeDialog) return Promise.resolve(null);
      return new Promise(resolve => {
        const dialog = element("dialog", "", "breakout-dialog");
        activeDialog = dialog;
        const form = element("form");
        form.method = "dialog";
        const heading = element("h2", title);
        heading.id = "breakoutDialogTitle";
        dialog.setAttribute("aria-labelledby", heading.id);
        form.append(heading);
        if (detail) form.append(element("p", detail));
        let input;
        if (label) {
          const field = element("label", label);
          input = element(limit > 80 ? "textarea" : "input");
          input.value = value;
          input.maxLength = limit;
          input.required = true;
          field.append(input);
          form.append(field);
        }
        const actions = element("div", "", "breakout-dialog-actions");
        actions.append(button("Cancel", () => dialog.close("cancel")));
        const submit = element("button", accept);
        submit.type = "submit";
        submit.value = "confirm";
        actions.append(submit);
        form.append(actions);
        form.addEventListener("submit", event => {
          event.preventDefault();
          if (input && !input.value.trim()) { input.focus(); return; }
          dialog.close("confirm");
        });
        dialog.append(form);
        dialog.addEventListener("close", () => {
          const result = dialog.returnValue === "confirm" ? (input ? input.value.trim() : true) : null;
          dialog.remove();
          activeDialog = null;
          resolve(result);
        }, {once: true});
        root.append(dialog);
        dialog.showModal();
        input?.focus();
      });
    }
    function request(action = "list", values = {}) {
      return new Promise((resolve, reject) => {
        options.socket.timeout(action === "list" ? 15000 : 120000).emit("breakout_rooms", {
          presentationId: options.presentationId, authToken: options.authToken || "",
          shareToken: options.shareToken || "", resumeToken, action, ...values
        }, (error, result) => {
          if (error || !result?.ok) reject(new Error(result?.error || "Room request timed out. Refresh rooms before retrying."));
          else resolve(result);
        });
      });
    }
    async function navigate(url) {
      if (transferring) return;
      const destination = new URL(url, location.origin);
      if (destination.origin !== location.origin || !["/present.html", "/controller.html"].includes(destination.pathname)) return;
      transferring = true;
      message.textContent = "Moving to your room...";
      try {
        hooks.remember();
        await options.onBeforeRoomSwitch?.();
        await hooks.leave();
        location.replace(destination.href);
      } catch (error) {
        transferring = false;
        message.textContent = error.message || "Room switch could not finish. Retry after saving your recording.";
      }
    }
    async function refresh() {
      if (busy || transferring || (!resumeToken && !options.controller)) return;
      try {
        state = await request();
        if (state.returnUrl) sessionStorage.setItem(`presentStudio.breakoutReturn.${options.presentationId}`, state.returnUrl);
        else if (options.controller && options.authToken && state.parentId !== options.presentationId) sessionStorage.setItem(`presentStudio.breakoutReturn.${options.presentationId}`, `/controller.html?id=${encodeURIComponent(state.parentId)}&breakoutJoin=1`);
        if (state.url) { await navigate(state.url); return; }
        if (!activeDialog && !panel.contains(document.activeElement)) render();
      } catch (error) {
        message.textContent = error.message;
        if (/room is closed|main meeting is not live/i.test(error.message)) recover(options.presentationId);
      }
    }
    async function command(action, values) {
      if (busy || transferring) return;
      busy = true;
      if (action === "visit") hooks.remember();
      panel.setAttribute("aria-busy", "true");
      try {
        const result = await request(action, values);
        selected.clear();
        if (result.url) { await navigate(result.url); return; }
        state = result;
        render();
      } catch (error) { message.textContent = error.message; }
      finally { busy = false; panel.removeAttribute("aria-busy"); }
    }
    async function confirmMove(ids, room) {
      if (!ids.length || !await ask({title: "Move participants", message: `Move ${ids.length} participant(s) to ${room.name}? Screen sharing will stop.`, accept: "Move"})) return;
      command("move", {guestIds: ids, roomId: room.id});
    }
    function render() {
      controls.replaceChildren();
      list.replaceChildren();
      const current = state.rooms.find(r => r.presentationId === options.presentationId);
      const closeMeeting = root.querySelector("[data-live-close]");
      if (closeMeeting && current?.id !== "main") closeMeeting.hidden = true;
      message.textContent = state.closingAt ? `Rooms closing in ${Math.max(0, Math.ceil(state.closingAt - Date.now() / 1000))} seconds` : current ? `Current room: ${current.name}` : "Meeting rooms";
      if (state.manager) {
        controls.append(button("Create room", async () => {
          const name = await ask({title: "Create breakout room", label: "Room name", value: `Room ${state.rooms.length}`, accept: "Create"});
          if (name?.trim()) command("create", {name});
        }), button("Auto-assign", async () => {
          if (await ask({title: "Assign participants", message: "Distribute admitted audiences across all breakout rooms?", accept: "Assign"})) command("auto-assign");
        }), button("Announcement", async () => {
          const text = await ask({title: "Announce to all rooms", label: "Announcement", limit: 500, accept: "Send"});
          if (text?.trim()) command("announce", {text});
        }), button("Close all rooms", async () => {
          if (await ask({title: "Close breakout rooms", message: "Everyone will return to the main room after a 30-second countdown.", accept: "Close rooms"})) command("close-all");
        }));
      } else if (current?.id !== "main" && current?.allowReturn) {
        controls.append(button("Return to main room", () => command("return")));
      }
      for (const room of state.rooms) {
        const section = element("section", "", "breakout-room");
        section.classList.toggle("is-current", room.id === current?.id);
        const occupants = state.participants.filter(p => p.roomId === room.id);
        const header = element("header");
        header.append(element("strong", room.name));
        if (state.manager) {
          header.append(element("span", String(occupants.length)), button(room.id === current?.id ? "Joined" : "Join", () => {
            if (room.id !== current?.id) command("visit", {roomId: room.id});
          }));
          section.addEventListener("dragover", event => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; });
          section.addEventListener("drop", event => {
            event.preventDefault();
            const id = event.dataTransfer.getData("text/x-snapkey-participant");
            if (state.participants.some(p => p.id === id)) confirmMove(selected.has(id) ? [...selected] : [id], room);
          });
          if (selected.size) header.append(button("Move selected here", () => confirmMove([...selected], room)));
          if (room.id !== "main") {
            header.append(button("Rename", async () => {
              const name = await ask({title: "Rename room", label: "Room name", value: room.name, accept: "Save"});
              if (name?.trim()) command("rename", {roomId: room.id, name});
            }), button("Delete", async () => {
              if (await ask({title: "Delete room", message: `Delete empty room ${room.name}?`, accept: "Delete"})) command("delete", {roomId: room.id});
            }));
            const label = element("label", "Allow return to main ");
            const toggle = element("input");
            toggle.type = "checkbox";
            toggle.checked = room.allowReturn;
            toggle.addEventListener("change", () => command("return-policy", {roomId: room.id, allowReturn: toggle.checked}));
            label.prepend(toggle);
            section.append(label);
          }
        }
        section.prepend(header);
        for (const person of occupants) {
          const row = element("div", "", "breakout-person");
          row.draggable = true;
          row.addEventListener("dragstart", event => event.dataTransfer.setData("text/x-snapkey-participant", person.id));
          const check = element("input");
          check.type = "checkbox";
          check.checked = selected.has(person.id);
          check.setAttribute("aria-label", `Select ${person.name}`);
          check.addEventListener("change", () => { check.checked ? selected.add(person.id) : selected.delete(person.id); render(); });
          row.append(check, element("span", person.name + (person.connected ? "" : " (offline)")));
          const select = element("select");
          select.setAttribute("aria-label", `Move ${person.name} to room`);
          for (const destination of state.rooms) {
            const option = element("option", destination.name);
            option.value = destination.id;
            option.selected = destination.id === room.id;
            select.append(option);
          }
          select.addEventListener("change", () => {
            const target = state.rooms.find(r => r.id === select.value);
            select.value = room.id;
            confirmMove([person.id], target);
          });
          row.append(select);
          section.append(row);
        }
        list.append(section);
      }
    }
    options.socket.on("breakout_credential", data => {
      if (data.presentationId === options.presentationId) {
        resumeToken = data.resumeToken;
        try { sessionStorage.setItem(`presentStudio.breakoutCredential.${options.presentationId}`, resumeToken); } catch {}
        refresh();
      }
    });
    options.socket.on("breakout_transfer", data => {
      try {
        const id = new URL(data.url, location.origin).searchParams.get("id");
        if (data.returnUrl && id) sessionStorage.setItem(`presentStudio.breakoutReturn.${id}`, data.returnUrl);
      } catch {}
      navigate(data.url);
    });
    options.socket.on("breakout_transfer_pending", data => {
      hooks.remember();
      hooks.status(`Moving to ${String(data.roomName || "your room").slice(0, 80)}. Screen sharing will stop.`);
    });
    options.socket.on("breakout_directory_changed", refresh);
    options.socket.on("breakout_announcement", data => hooks.status(`Host announcement: ${String(data.text || "").slice(0, 500)}`));
    options.socket.on("breakout_closed", data => {
      if (options.controller && options.authToken) navigate(`/controller.html?id=${encodeURIComponent(data.parentId)}&breakoutJoin=1`);
    });
    options.socket.on("connect", refresh);
    panel.addEventListener("focusout", () => requestAnimationFrame(() => {
      if (state && !busy && !activeDialog && !panel.contains(document.activeElement)) render();
    }));
    options.socket.on("meeting_lobby_state", refresh);
    const timer = window.setInterval(refresh, 10000);
    const countdown = window.setInterval(() => {
      if (state?.closingAt) message.textContent = `Rooms closing in ${Math.max(0, Math.ceil(state.closingAt - Date.now() / 1000))} seconds`;
    }, 1000);
    window.addEventListener("pagehide", () => { window.clearInterval(timer); window.clearInterval(countdown); }, {once: true});
    queueMicrotask(refresh);
    return {refresh};
  }
  function recover(id) {
    try {
      const value = sessionStorage.getItem(`presentStudio.breakoutReturn.${id}`);
      if (!value) return false;
      const url = new URL(value, location.origin);
      if (url.origin !== location.origin || !["/present.html", "/controller.html"].includes(url.pathname) || url.searchParams.get("id") === id) return false;
      sessionStorage.removeItem(`presentStudio.breakoutReturn.${id}`);
      location.replace(url.href);
      return true;
    } catch { return false; }
  }
  window.SnapKeyBreakoutRooms = {mount, recover};
})();
