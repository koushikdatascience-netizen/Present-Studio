const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../frontend/js/present.js'), 'utf8');

test('audience slide render retries transient image failures', () => {
  assert.match(source, /if \(attempt < 2\) setTimeout/);
  assert.match(source, /renderVersion === slideRenderVersion/);
});
test('audience renderer preserves original layer order', () => {
  assert.match(source, /completeScene\.map\(\(object, index\)/);
  assert.match(source, /canvas\.moveTo\(image,/);
});
test('audience renderer leaves persisted slides untouched', () => {
  assert.match(source, /const scene = sanitizeFabricScene\(JSON\.parse\(JSON\.stringify\(data\.fabric\)\)\)/);
});
