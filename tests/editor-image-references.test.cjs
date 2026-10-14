const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../frontend/js/editor.js'), 'utf8');

test('converted image URLs persist in subsequent canvas captures without traversing Fabric back-pointers', () => {
  const inline = 'data:image/png;base64,original';
  const before = { slides: [{ canvas: { fabric: { objects: [{ src: inline }] } } }] };
  const after = { slides: [{ canvas: { fabric: { objects: [{ src: '/api/media/asset/content', thumbnailSrc: '/api/media/asset/image-preview' }] } } }] };
  const local = JSON.parse(JSON.stringify(before));
  const image = { src: inline, getSrc() { return inline; }, set(values) { Object.assign(this, values); } };
  const canvas = { getObjects() { return [image]; } };
  image.canvas = canvas;
  const context = { presentation: local, canvas, Map, Object };
  const start = source.indexOf('function applySavedImageReferences(');
  const end = source.indexOf('async function save()', start);
  vm.runInNewContext(source.slice(start, end), context);
  context.applySavedImageReferences(before, after);
  assert.equal(image.src, '/api/media/asset/content');
  assert.equal(image.thumbnailSrc, '/api/media/asset/image-preview');
  assert.equal(local.slides[0].canvas.fabric.objects[0].src, image.src);
});

test('newer image replacements are never overwritten by an earlier save response', () => {
  const before = { slides: [{ canvas: { fabric: { objects: [{ src: 'data:image/png;base64,old' }] } } }] };
  const after = { slides: [{ canvas: { fabric: { objects: [{ src: '/api/media/old/content' }] } } }] };
  const image = { src: '/api/media/new/content', set(values) { Object.assign(this, values); } };
  const context = { presentation: { slides: [{ canvas: { src: image.src } }] }, canvas: { getObjects() { return [image]; } }, Map, Object };
  const start = source.indexOf('function applySavedImageReferences(');
  vm.runInNewContext(source.slice(start, source.indexOf('async function save()', start)), context);
  context.applySavedImageReferences(before, after);
  assert.equal(image.src, '/api/media/new/content');
});
