const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../frontend/js/live-media.js"), "utf8");

test("pasted chat images are staged instead of uploaded immediately", () => {
  const pasteStart = source.indexOf('chatInput?.addEventListener("paste"');
  const pasteEnd = source.indexOf('chatMessages?.addEventListener("dragover"', pasteStart);
  const pasteHandler = source.slice(pasteStart, pasteEnd);
  assert.match(pasteHandler, /stageChatAttachment\(file\)/);
  assert.doesNotMatch(pasteHandler, /uploadMeetingAttachment\(file/);
  assert.match(source, /await uploadMeetingAttachment\(file, text\)/);
});

test("a staged attachment can be removed before sending", () => {
  const helperStart = source.indexOf("function formatChatFileSize");
  const helperEnd = source.indexOf("async function uploadMeetingAttachment", helperStart);
  const helperSource = source.slice(helperStart, helperEnd);
  const classes = new Set();
  const context = {
    window: { URL: { createObjectURL: () => "blob:preview", revokeObjectURL: () => {} } },
    room: {},
    chatUploading: false,
    pendingChatFile: null,
    pendingChatPreviewUrl: "",
    chatInput: { value: "" },
    chatAttachButton: { disabled: false },
    chatSubmit: { disabled: false },
    chatPendingRemove: { disabled: false },
    chatPending: {
      hidden: true,
      classList: {
        toggle(name, active) { active ? classes.add(name) : classes.delete(name); },
        remove(name) { classes.delete(name); }
      }
    },
    chatPendingImage: { hidden: true, src: "", removeAttribute() { this.src = ""; } },
    chatPendingName: { textContent: "" },
    chatPendingSize: { textContent: "" },
    chatFileInput: { value: "chosen" },
    setStatus() {},
    setSidebarTab() {}
  };
  vm.runInNewContext(`${helperSource}; this.stage = stageChatAttachment; this.clear = clearPendingChatAttachment; this.pending = () => pendingChatFile;`, context);

  context.stage({ name: "clipboard.png", type: "image/png", size: 2048 });
  assert.equal(context.chatPending.hidden, false);
  assert.equal(context.chatPendingImage.src, "blob:preview");
  assert.equal(context.chatPendingName.textContent, "clipboard.png");
  assert.equal(context.pending().name, "clipboard.png");

  context.clear();
  assert.equal(context.chatPending.hidden, true);
  assert.equal(context.chatPendingImage.src, "");
  assert.equal(context.pending(), null);
});

test("presenter and audience composers include compact remove controls", () => {
  for (const page of ["controller.html", "present.html"]) {
    const html = fs.readFileSync(path.join(__dirname, `../frontend/${page}`), "utf8");
    assert.match(html, /data-live-chat-pending-remove/);
    assert.match(html, /class="live-chat-attach"[^>]*><svg/);
    assert.match(html, /class="live-chat-send"[^>]*><svg/);
  }
});
