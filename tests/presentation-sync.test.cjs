const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function api() {
  const context = { window: {}, console, localStorage: { getItem() {} } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../frontend/js/api.js'), 'utf8').split('/* MEETING_V2_BRIDGE')[0], context);
  return context.window.PresentStudioApi;
}
function deck(version = 'v1') { return { id: 'p', title: 'Deck', updatedAt: version,
  slides: [{ id: 'a', canvas: { text: 'A' } }, { id: 'b', canvas: { text: 'B' } }] }; }
function delta(base, version, slides = [], order = ['a', 'b']) {
  return { presentationId: 'p', baseUpdatedAt: base,
    changes: { updatedAt: version, title: 'Saved', slides, slideOrder: order } };
}
test('deltas retain unchanged scenes, apply edits, reorder and delete slides', async () => {
  let current = deck(); const unchanged = current.slides[0];
  const apply = api().presentationUpdates(() => current, () => { throw Error('unexpected fetch'); }, e => current = e.presentation);
  await apply(delta('v1', 'v2', [{ id: 'b', canvas: { text: 'Edited' } }], ['b', 'a']));
  assert.equal(current.slides[1], unchanged); assert.equal(current.slides[0].canvas.text, 'Edited');
  await apply(delta('v2', 'v3', [], ['a']));
  assert.equal(current.slides.length, 1); assert.equal(current.slides[0], unchanged);
});
test('missed and out-of-order events recover using authorized fetch instead of rolling back', async () => {
  let current = deck(); let fetches = 0;
  const apply = api().presentationUpdates(() => current, async () => { fetches++; return { presentation: deck('v4') }; }, e => current = e.presentation);
  await apply(delta('v2', 'v3')); assert.equal(current.updatedAt, 'v4');
  await apply(delta('v1', 'v2')); assert.equal(current.updatedAt, 'v4'); assert.equal(fetches, 2);
  await apply(delta('v3', 'v4')); assert.equal(fetches, 2);
});
test('updates queue behind recovery and preserve subsequent changes', async () => {
  let current = deck(); let resolve;
  const apply = api().presentationUpdates(() => current, () => new Promise(r => resolve = r), e => current = e.presentation);
  const recovery = apply(delta('missing', 'v2')); await Promise.resolve();
  const next = apply(delta('v2', 'v3', [], ['b']));
  resolve({ presentation: deck('v2') }); await recovery; await next;
  assert.equal(current.updatedAt, 'v3'); assert.equal(current.slides[0].id, 'b');
});
test('failed refresh preserves local state and retries on next event', async () => {
  let current = deck(); let calls = 0; let errors = 0;
  const apply = api().presentationUpdates(() => current, async () => {
    if (++calls === 1) throw Error('offline'); return { presentation: deck('v3') };
  }, e => current = e.presentation, () => errors++);
  await apply(delta('v2', 'v3')); assert.equal(current.updatedAt, 'v1'); assert.equal(errors, 1);
  await apply(delta('v2', 'v3')); assert.equal(current.updatedAt, 'v3');
});
test('ignores other decks and tolerates legacy full snapshots', async () => {
  let current = deck(); const apply = api().presentationUpdates(() => current, () => { throw Error('fetch'); }, e => current = e.presentation);
  await apply({ ...delta('v1', 'v2'), presentationId: 'other' }); assert.equal(current.updatedAt, 'v1');
  await apply({ presentationId: 'p', presentation: deck('v3') }); assert.equal(current.updatedAt, 'v3');
});

test('reconnect refreshes the last missed save without waiting for another edit', async () => {
  let current = deck(); let connect;
  api().presentationUpdates(() => current, async () => ({ presentation: deck('v2') }), e => current = e.presentation,
    error => { throw error; }, { on(name, fn) { assert.equal(name, 'connect'); connect = fn; } });
  await connect(); assert.equal(current.updatedAt, 'v2');
});

test('recovery restores canonical live state when the previously active slide was deleted', async () => {
  let current = deck(); let live;
  const apply = api().presentationUpdates(() => current, async () => ({
    presentation: { ...deck('v3'), slides: [{ id: 'b', canvas: {} }] }, liveState: { slideId: 'b' }
  }), e => { current = e.presentation; live = e.liveState; });
  await apply(delta('v2', 'v3'));
  assert.equal(current.slides.length, 1); assert.equal(live.slideId, 'b');
});
