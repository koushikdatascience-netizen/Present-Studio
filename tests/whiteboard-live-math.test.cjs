const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
class Shape { constructor(...args) { this.args = args; Object.assign(this, args.at(-1)); } }
const fabric = Object.fromEntries(['Line', 'Text', 'Circle', 'Rect', 'Polygon', 'Polyline', 'Group'].map(name => [name, class extends Shape { constructor(...args) { super(...args); this.type = name.toLowerCase(); } }]));
const math = { derivative: () => ({ compile: () => ({ evaluate: ({ x }) => 2 * x }) }) };
const context = { window: { SnapKeyWhiteboardStudios: { expression: () => ({ traverse: () => {}, compile: () => ({ evaluate: ({ x }) => x * x }) }) } }, fabric };
vm.runInNewContext(fs.readFileSync('frontend/js/whiteboard-live-math.js', 'utf8'), context);
const live = context.window.SnapKeyLiveMath;
test('all live lesson objects render vector primitives, not images', () => {
  for (const kind of ['graph', 'fraction', 'numberline', 'geometry', 'tangent', 'integral', 'matrix']) {
    const model = live.defaults(kind); const group = live.render(model, math);
    assert.equal(group.type, 'group'); assert.equal(group.wbMath.kind, kind);
    assert(group.args[0].length > 1); assert(group.args[0].every(object => object.type !== 'image'));
  }
});
test('fraction and graph parameters change rendered mathematics', () => {
  const model = live.defaults('fraction'); const before = live.render(model, math);
  model.numerator = 5; const after = live.render(model, math);
  const filled = group => group.args[0].filter(object => object.fill === '#ffda45').length;
  assert.equal(filled(before), 3); assert.equal(filled(after), 5);
  assert.equal(before.wbMath.numerator, 3);
});
test('live metadata survives JSON round-trip and rejects invalid ranges', () => {
  const model = JSON.parse(JSON.stringify(live.defaults('graph')));
  assert.doesNotThrow(() => live.validate(model));
  for (const change of [{ minimum: 5 }, { denominator: 0 }, { numerator: 25 }, { parameter: NaN }, { count: 1000 }, { version: 2 }]) assert.throws(() => live.validate({ ...model, ...change }));
});
