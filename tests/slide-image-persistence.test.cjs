// Regression checks for protecting previously saved images when Fabric fails to reload them.
// Run: node --test tests/slide-image-persistence.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../frontend/js/editor.js'), 'utf8');
const begin = source.indexOf('function imageIdentity(');
const end = source.indexOf('function load(){', begin);
assert.ok(begin >= 0 && end > begin, 'image restore guard exists');
// Evaluate only the pure image-identity comparison functions, not browser code.
const validate = new Function(source.slice(begin, end) + '; return validateRestoredImages;')();
test('reject a partially restored slide before it can be saved', () => {
  assert.deepEqual(validate([{type:'image', id:'photo-a'}, {type:'image', id:'photo-b'}],
    [{type:'image', id:'photo-a'}]), ['photo-b']);
});
test('accept fully restored images', () => {
  assert.deepEqual(validate([{type:'image', id:'photo-a'}], [{type:'image', id:'photo-a'}]), []);
});
test('handle identical images independently', () => {
  assert.equal(validate([{type:'image', src:'asset.png'}, {type:'image', src:'asset.png'}],
    [{type:'image', src:'asset.png'}]).length, 1);
});
test('ignore non-image canvas elements', () => {
  assert.deepEqual(validate([{type:'textbox', id:'a'}], []), []);
});
test('editor serializes immutable save snapshots instead of replacing working state', () => {
  assert.match(source, /if\(savePromise\)return savePromise\.then/);
  assert.match(source, /JSON\.parse\(JSON\.stringify\(presentation\)\)/);
  assert.match(source, /if\(editRevision===revision\)/);
});
test('unavailable old images are preserved in serialized saves', () => {
  assert.match(source, /unavailableSavedImages=expected\.flatMap/);
  assert.match(source, /objects\.splice\(index,0,JSON\.parse\(JSON\.stringify\(entry\.object\)\)\)/);
  assert.doesNotMatch(source, /if\(imageRestoreProblem\)return Promise\.reject/);
});

test('cross-tab save conflict blocks further overwrites', () => {
  assert.match(source, /presentation\.updatedAt=r\.presentation\.updatedAt/);
  assert.match(source, /saveConflict=true/);
  assert.match(source, /if\(!autosaveRequested\|\|loading\|\|pendingInsertions\|\|saveConflict\)return/);
});
test('avoid media library repaint on every slide navigation', () => {
  assert.match(source, /gridEl\.dataset\.assetSignature===signature/);
});

test('image insertions must finish before saves begin', () => {
  assert.match(source, /pendingInsertions\+\+/);
  assert.match(source, /if\(loading\|\|pendingInsertions\)return Promise\.reject/);
});
test('Fabric reloads are isolated from the visible canvas', () => {
  assert.match(source, /const staging=new fabric.StaticCanvas/);
});
