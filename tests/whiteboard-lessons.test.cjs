const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync('frontend/js/whiteboard-lessons.js', 'utf8'), context);
const lessons = context.window.SnapKeyLessons;
test('lesson templates cover school arithmetic, geometry and university demonstrations', () => {
  assert.equal(new Set(lessons.templates.map(item => item.id)).size, 9);
  for (const kind of ['fraction', 'numberline', 'geometry', 'graph', 'tangent', 'integral', 'matrix']) assert(lessons.templates.some(item => item.kind === kind));
});
test('fraction explanations use checked integer reduction, including zero', () => {
  assert(lessons.explanations({ kind: 'fraction', numerator: 4, denominator: 8 }).steps.at(-1).includes('1/2'));
  assert(lessons.explanations({ kind: 'fraction', numerator: 0, denominator: 8 }).steps.at(-1).includes('0/1'));
});
test('numerical demonstrations are not presented as convergence proofs', () => {
  const result = lessons.explanations({ kind: 'integral', minimum: 0, maximum: 1, count: 12 });
  assert(result.status.includes('not proof')); assert(result.steps.some(step => step.includes('cannot establish')));
});
