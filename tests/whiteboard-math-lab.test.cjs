const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync('frontend/js/whiteboard-math-lab.js', 'utf8'), context);
const { bounds, matrix } = context.window.SnapKeyWhiteboardMathLab;
test('sequence bounds enforce finite integer terms and sampling budget', () => {
  assert.doesNotThrow(() => bounds(1, 500, true));
  for (const [a, b] of [[1, 501], [0.5, 20], [3, 3], [Infinity, 4], [-1e7, -1e7 + 4]]) assert.throws(() => bounds(a, b, true));
});
test('calculus domains must be finite and bounded', () => {
  assert.doesNotThrow(() => bounds(-5, 5));
  assert.throws(() => bounds(0, 1001));
  assert.throws(() => bounds(0, NaN));
});
test('matrix validation rejects ragged, complex and oversized matrices', () => {
  const good = [[2, 1], [1, 3]];
  assert.equal(matrix({}, good), good);
  assert.equal(matrix({}, { toArray: () => good }), good);
  for (const bad of [[[1], [1, 2]], [[NaN]], [[{ re: 1, im: 2 }]], Array.from({ length: 5 }, () => [1]), [1, 2]]) assert.throws(() => matrix({}, bad));
});
test('symbolic worker constructs supported operations and reports unresolved results', () => {
  const commands = []; const messages = [];
  const worker = { importScripts: () => {}, self: { postMessage: value => messages.push(value) }, nerdamer: command => { commands.push(command); return { text: () => command.startsWith('limit') ? command : '1/3', evaluate: () => ({ text: () => '0.333333333' }) }; } };
  vm.runInNewContext(fs.readFileSync('frontend/js/math-lab-worker.js', 'utf8'), worker);
  worker.self.onmessage({ data: { mode: 'integral', source: 'x^2', lower: 0, upper: 1 } });
  assert.equal(commands[0], 'defint(x^2,0,1,x)'); assert.equal(messages[0].unresolved, false);
  worker.self.onmessage({ data: { mode: 'limit', source: 'sin(x)/x', point: 0 } });
  assert.equal(messages[1].unresolved, true); assert.equal(messages[1].approximate, '');
});
