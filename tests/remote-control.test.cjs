const test = require('node:test');
const assert = require('node:assert/strict');
const { coordinates } = require('../frontend/js/remote-control.js');
test('maps letterboxed primary display coordinates', () => {
  const rect = { left: 10, top: 20, width: 1000, height: 1000 };
  assert.deepEqual(coordinates(rect, 1920, 1080, 510, 520), { x: .5, y: .5 });
  assert.equal(coordinates(rect, 1920, 1080, 510, 30), null);
  assert.ok(Math.abs(coordinates(rect, 1920, 1080, 10, 238.75).x) < 1e-12);
});
test('maps portrait display without stretching', () => {
  const rect = { left: 0, top: 0, width: 1200, height: 600 };
  assert.deepEqual(coordinates(rect, 600, 1200, 600, 300), { x: .5, y: .5 });
  assert.equal(coordinates(rect, 600, 1200, 20, 300), null);
});
