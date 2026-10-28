const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const editor = fs.readFileSync(path.join(__dirname, '../frontend/js/editor.js'), 'utf8');
const ui = fs.readFileSync(path.join(__dirname, '../frontend/js/builder-ui.js'), 'utf8');

function autosaveHarness() {
  let nextTimer = 0;
  const timers = new Map(), decodes = [], saved = [];
  const context = {
    presentation: { slides: [{ id: 'a', title: 'A', canvas: { fabric: { objects: [] } } }, { id: 'b', title: 'B', canvas: { fabric: { objects: [] } } }] },
    currentSlideIndex: 0, editRevision: 0, saveTimer: null, loading: false,
    pendingInsertions: 0, saveConflict: false, autosaveRequested: false,
    slideLoadVersion: 0, imageRestoreProblem: '', unavailableSavedImages: [],
    W: 1280, H: 720, $: () => ({}), capture() {}, normalize() {}, panel() {},
    prefetchAdjacentImages() {}, validateRestoredImages: () => [], toast() {},
    activeSlide() { return context.presentation.slides[context.currentSlideIndex]; },
    ensure(slide) { slide.canvas.elements ||= []; return slide; },
    playback: () => ({ slide_ids: [] }), text: item => item,
    canvas: { clear() {}, add() {}, renderAll() {} },
    fabric: { StaticCanvas: class {
      loadFromJSON(data, callback) { decodes.push(callback); }
      getObjects() { return []; } remove() {} dispose() {}
    } },
    render() { context.load(); },
    setTimeout(callback) { timers.set(++nextTimer, callback); return nextTimer; },
    clearTimeout(id) { timers.delete(id); },
    async save() { saved.push(JSON.parse(JSON.stringify(context.presentation))); },
  };
  vm.createContext(context);
  vm.runInContext(editor.slice(editor.indexOf('function load(){'), editor.indexOf('function esc(')), context);
  vm.runInContext(editor.slice(editor.indexOf('function resumeAutosave(){'), editor.indexOf('function addAsset(')), context);
  return { context, timers, decodes, saved,
    tick() { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); },
    finish() { decodes.splice(0).forEach(fn => fn()); }
  };
}

for (const operation of ['addSlide', 'duplicateSlide', 'deleteSlide']) {
  test(`${operation} persists after asynchronous rendering without another edit`, async () => {
    const h = autosaveHarness();
    h.context[operation]();
    assert.equal(h.context.editRevision, 1);
    assert.equal(h.saved.length, 0);
    assert.equal(h.timers.size, 0);
    await Promise.resolve(); // Legacy text-only slides also load asynchronously.
    h.finish(); h.tick();
    assert.equal(h.saved.length, 1);
    assert.equal(h.saved[0].slides.length, operation === 'deleteSlide' ? 1 : 3);
  });
}

test('an existing autosave waits for navigation and resumes after the latest decode', () => {
  const h = autosaveHarness();
  h.context.schedule();
  h.context.move(1);
  h.tick();
  assert.equal(h.saved.length, 0);
  assert.equal(h.context.autosaveRequested, true);
  h.context.move(-1);
  h.decodes.shift()(); // Obsolete load must not resume the save.
  assert.equal(h.timers.size, 0);
  h.finish(); h.tick();
  assert.equal(h.saved.length, 1);
});

test('pending insertion and save conflict guards retain their protection', () => {
  const h = autosaveHarness();
  h.context.pendingInsertions = 1;
  h.context.schedule(); h.tick();
  assert.equal(h.saved.length, 0);
  h.context.pendingInsertions = 0;
  h.context.resumeAutosave(); h.tick();
  assert.equal(h.saved.length, 1);
  h.context.saveConflict = true;
  h.context.schedule(); h.context.resumeAutosave(); h.tick();
  assert.equal(h.saved.length, 1);
});

function animationHarness({ deferred = false } = {}) {
  let nextTimer = 0, schedules = 0;
  const timers = new Map(), scenes = [], callbacks = [];
  const object = { type: 'textbox', animation: 'fly', left: 320, top: 250,
    opacity: 1, scaleX: 1, scaleY: 1, animationDuration: 1000, animationDelay: 0,
    set(values) { Object.assign(this, values); } };
  const controls = Object.fromEntries(['animationDuration', 'animationDelay'].map(id => [id, {
    value: id === 'animationDuration' ? '2000' : '500',
    addEventListener(event, callback) { this[event] = callback; }
  }]));
  const context = { animationPreview: null, active: () => object, toast() {},
    W: 1280, H: 720, byId: id => controls[id], all: () => [],
    schedule() { schedules++; },
    canvas: { getObjects: () => [object], toJSON: () => ({objects: [JSON.parse(JSON.stringify(object))]}),
      wrapperEl: { append() {} }, backgroundColor: '#fff', on() {} },
    document: { createElement: () => ({ style: {}, setAttribute() {}, remove() { this.removed = true; } }) },
    window: { setTimeout(fn, ms) { timers.set(++nextTimer, {fn, ms}); return nextTimer; }, clearTimeout(id) { timers.delete(id); } },
    fabric: { util: { ease: { easeOutCubic() {} } }, runningAnimations: {cancelByCanvas() {}},
      StaticCanvas: class {
        constructor(element) { this.element = element; this.animations = []; scenes.push(this); }
        loadFromJSON(data, callback) {
          this.objects = data.objects.map(value => ({ ...value,
            set(patch) { Object.assign(this, patch); },
            animate: (key, value, options) => this.animations.push({key, value, options})
          }));
          if (deferred) callbacks.push(callback); else callback();
        }
        getObjects() { return this.objects; } renderAll() {} dispose() { this.disposed = true; }
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(ui.slice(ui.indexOf('  function animationStartState('), ui.indexOf('  function showTransitionOptions(')), context);
  vm.runInContext(ui.slice(ui.indexOf('  function setObjectAnimation('), ui.indexOf('  document.querySelector(".ribbon").addEventListener("pointerdown"')), context);
  return { context, object, scenes, timers, callbacks, controls, schedules: () => schedules };
}

test('preview and repeated preview never mutate the objects captured by saving', () => {
  const h = animationHarness();
  const before = JSON.stringify(h.object);
  h.context.previewObjectAnimation();
  assert.equal(h.scenes[0].objects[0].left, 180);
  assert.equal(JSON.stringify(h.object), before);
  assert.equal([...h.timers.values()][0].ms, 0); // Respect an authored zero delay.
  h.context.previewObjectAnimation();
  assert.equal(h.scenes[0].disposed, true);
  assert.equal(h.scenes[1].objects[0].left, 180);
  assert.equal(JSON.stringify(h.object), before);
  assert.equal(h.timers.size, 1);
  const {fn} = [...h.timers.values()][0]; fn();
  h.scenes[1].animations.forEach(a => a.options.onComplete());
  assert.equal(h.scenes[1].disposed, true);
});

test('navigation cancels an unfinished preview decode without showing a stale scene', () => {
  const h = animationHarness({deferred: true});
  h.context.previewObjectAnimation();
  h.context.stopObjectAnimationPreview();
  assert.equal(h.scenes[0].disposed, undefined);
  h.callbacks[0]();
  assert.equal(h.scenes[0].disposed, true);
  assert.equal(h.timers.size, 0);
});

test('ribbon timing inputs update and schedule saving without reselecting a preset', () => {
  const h = animationHarness();
  h.controls.animationDuration.input();
  assert.equal(h.object.animationDuration, 2000);
  assert.equal(h.object.animationDelay, 500);
  h.controls.animationDelay.value = '0'; h.controls.animationDelay.input();
  assert.equal(h.object.animationDelay, 0);
  assert.equal(h.schedules(), 2);
});
