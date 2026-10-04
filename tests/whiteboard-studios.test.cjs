const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync('frontend/js/whiteboard-studios.js', 'utf8'), context);
const validate = context.window.SnapKeyWhiteboardStudios.expression;
const mock = items => ({ parse: () => ({ traverse: fn => items.forEach(fn) }) });
test('calculator rejects code and unknown symbols', () => {
  for (const item of [{ type: 'AssignmentNode' }, { type: 'AccessorNode' }, { type: 'SymbolNode', name: 'import' }, { type: 'ConstantNode', value: 'code' }]) assert.throws(() => validate(mock([item]), 'test'));
});
test('calculator accepts numerical and symbolic mathematics', () => {
  assert.doesNotThrow(() => validate(mock([{ type: 'SymbolNode', name: 'sin' }, { type: 'ConstantNode', value: 30 }]), 'sin(30)'));
  assert.throws(() => validate(mock([{ type: 'SymbolNode', name: 'x' }]), 'x'));
  assert.doesNotThrow(() => validate(mock([{ type: 'SymbolNode', name: 'x' }]), 'x', true));
});
test('calculator bounds factorials and matrices', () => {
  assert.throws(() => validate(mock([{ type: 'ArrayNode', items: Array(5) }]), '[1,2,3,4,5]'));
  assert.throws(() => validate(mock([{ type: 'FunctionNode', fn: { name: 'factorial' }, args: [{ isConstantNode: true, value: 1000 }] }]), 'factorial(1000)'));
});
