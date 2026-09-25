const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const presentSource = fs.readFileSync(path.join(__dirname, "../frontend/js/present.js"), "utf8");
const helperStart = presentSource.indexOf("function annotationCanvases");
const helperEnd = presentSource.indexOf("function addAudienceAnnotationText", helperStart);
const helperSource = presentSource.slice(helperStart, helperEnd);

function drawingHarness() {
  const calls = [];
  const context2d = new Proxy({}, {
    get(target, property) {
      if (property in target) return target[property];
      target[property] = (...args) => calls.push([property, ...args]);
      return target[property];
    },
    set(target, property, value) {
      target[property] = value;
      calls.push([`set:${property}`, value]);
      return true;
    }
  });
  const canvas = { width: 1280, height: 720, getContext: () => context2d };
  const context = { document: { querySelectorAll: () => [canvas] } };
  vm.runInNewContext(`${helperSource}; this.drawAudienceAnnotation = drawAudienceAnnotation; this.drawAudienceAnnotationShape = drawAudienceAnnotationShape;`, context);
  return { context, calls };
}

test("a highlighter tap renders a visible dot", () => {
  const harness = drawingHarness();
  harness.context.drawAudienceAnnotation([{ x: .5, y: .5 }], "#ffdc2d", 18);

  assert.ok(harness.calls.some(call => call[0] === "arc"));
  assert.ok(harness.calls.some(call => call[0] === "fill"));
});

test("rectangle, circle, line and arrow annotations render", () => {
  for (const shape of ["rectangle", "circle", "line", "arrow"]) {
    const harness = drawingHarness();
    harness.context.drawAudienceAnnotationShape({
      shape,
      start: { x: .2, y: .2 },
      end: { x: .7, y: .7 },
      color: "#20242b",
      size: 6
    });
    assert.ok(harness.calls.some(call => call[0] === "stroke"), `${shape} should be stroked`);
    if (shape === "rectangle") assert.ok(harness.calls.some(call => call[0] === "rect"));
    if (shape === "circle") assert.ok(harness.calls.some(call => call[0] === "ellipse"));
    if (shape === "arrow") assert.ok(harness.calls.some(call => call[0] === "fill"));
  }
});

test("both controller workspaces expose the whiteboard tools and brush cursor", () => {
  const html = fs.readFileSync(path.join(__dirname, "../frontend/controller.html"), "utf8");
  for (const tool of ["line", "arrow", "rectangle", "circle"]) {
    assert.equal((html.match(new RegExp(`data-preview-tool="${tool}"`, "g")) || []).length, 2);
  }
  assert.match(html, /id="previewWhiteboardCursor"/);
  assert.match(html, /id="interactiveWhiteboardCursor"/);
});

test("the server relays synchronized shape annotations", () => {
  const source = fs.readFileSync(path.join(__dirname, "../backend/app/socket_manager.py"), "utf8");
  assert.match(source, /\{"draw", "shape", "text", "clear", "viewport"\}/);
});
