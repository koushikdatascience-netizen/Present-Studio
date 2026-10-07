const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const math = require('mathjs');
const window = {};
class Shape { constructor(...args) { this.args = args; Object.assign(this, args.at(-1)); } }
const fabric = Object.fromEntries(['Line', 'Text', 'Circle', 'Rect', 'Polygon', 'Polyline', 'Group'].map(name => [name, class extends Shape { constructor(...args) { super(...args); this.type = name.toLowerCase(); } }]));
for (const file of ['whiteboard-polar', 'whiteboard-studios', 'whiteboard-keyboard', 'whiteboard-live-math']) new Function('window', 'fabric', 'document', 'matchMedia', fs.readFileSync(`frontend/js/${file}.js`, 'utf8'))(window, fabric, {}, () => ({ matches: false }));
const input = window.SnapKeyMathInput;
test('LaTeX and Unicode math inputs retain numeric meaning', () => {
  const cases = [
    [String.raw`r=a(1+\cos\theta)`, 2 * (1 + Math.cos(.7))],
    [String.raw`a\cos(3\theta)`, 2 * Math.cos(2.1)],
    [String.raw`\frac{1}{2}\sin^2\theta`, .5 * Math.sin(.7) ** 2],
    [String.raw`|\sin\theta|`, Math.abs(Math.sin(.7))],
    [String.raw`\sqrt[3]{x}`, 2],
    [String.raw`\cos 2\theta`, Math.cos(1.4)],
    ['2θ+π', 1.4 + Math.PI], ['a(1+cos(theta))', 2 * (1 + Math.cos(.7))],
    [String.raw`\ln x+\log x`, Math.log(8) + Math.log10(8)]
  ];
  for (const [source, expected] of cases) {
    const expression = input.stripLeft(source.includes('\\') ? input.latexToExpression(source) : input.normalize(source));
    const actual = math.evaluate(expression, { a: 2, theta: .7, x: 8 });
    assert(Math.abs(actual - expected) < 1e-9, `${source} -> ${expression}: ${actual}`);
  }
  assert.throws(() => input.latexToExpression('|x'));
  assert.throws(() => input.normalize('x'.repeat(2001)));
  assert.equal(input.latexToExpression(String.raw`\frac{1}{\sqrt{x}}`), '((1)/(sqrt(x)))');
});
test('domain bounds accept constants but reject code and other functions', () => {
  for (const [source, expected] of [['2*pi', 2 * Math.PI], ['pi/2', Math.PI / 2], ['-3pi', -3 * Math.PI], ['360°', 2 * Math.PI], ['sqrt(4)', 2]]) assert.equal(input.numberFrom(math, source), expected);
  for (const source of ['', 'abc', '2*pi; x', 'import("fs")', 'cos(1)', '1/0', 'sqrt(-1)']) assert.throws(() => input.numberFrom(math, source), source);
});
test('polar sampling preserves curves and breaks undefined radii', () => {
  const cardioid = input.polarPoints(theta => 1 + Math.cos(theta), 0, 2 * Math.PI);
  assert.equal(Math.max(...cardioid.x), 2); assert(Math.abs(Math.min(...cardioid.x) + .25) < .0001);
  const rose = input.polarPoints(theta => Math.cos(3 * theta), 0, 2 * Math.PI);
  assert(rose.x.every((x, i) => Math.hypot(x, rose.y[i]) <= 1.0000001));
  const lemniscate = input.polarPoints(theta => Math.sqrt(Math.cos(2 * theta)), 0, 2 * Math.PI);
  assert(lemniscate.x.includes(null)); assert.throws(() => input.polarPoints(() => 1, 2, 1));
  assert(input.polarGrid(2).shapes.some(shape => shape.type === 'circle'));
});
test('polar live objects are editable vectors with stable parameter scaling', () => {
  const live = window.SnapKeyLiveMath, model = live.defaults('polar');
  assert.doesNotThrow(() => live.validate(model));
  const first = live.render(model, math), second = live.render({ ...model, parameter: .5 }, math);
  assert(first.args[0].some(part => part.type === 'polyline')); assert(first.args[0].some(part => part.type === 'circle')); assert(first.args[0].every(part => part.type !== 'image'));
  const curve = group => group.args[0].find(part => part.type === 'polyline').args[0];
  assert.notDeepEqual(curve(first), curve(second));
  const rings = group => group.args[0].filter(part => part.type === 'circle').map(part => part.radius);
  assert.deepEqual(rings(first), rings(second));
  for (const expression of ['sqrt(-1-theta^2)', 'det(theta)', 'import("fs")']) assert.throws(() => live.render({ ...model, expression }, math), expression);
});
test('polar keyboard templates insert parseable math expressions', () => {
  for (const [, template] of window.SnapKeyMathKeyboard.pages.polar) {
    const source = template === 'r=' ? 'r=1' : ['(|)', ')', '-'].includes(template) ? '1' : template.replace('|', '1');
    assert.doesNotThrow(() => math.parse(input.stripLeft(source)));
  }
});
