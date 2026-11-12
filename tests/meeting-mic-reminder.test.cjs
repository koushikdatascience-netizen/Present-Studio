const {test} = require('node:test');
const assert = require('node:assert/strict');
const {due} = require('../frontend/js/meeting-reminder-policy.js');
const now = 1000000;
const record = changes => ({tabId:'other', microphoneOn:true, connected:true, hiddenSince:now-120000, at:now, screenSharing:false, ...changes});
test('background mic gets a reminder after two minutes, never immediately', () => {
  assert.equal(due([record({hiddenSince:now-119999})], 'current', now).length, 0);
  assert.equal(due([record({})], 'current', now).length, 1);
});
test('screen sharing gets a five minute grace period', () => {
  assert.equal(due([record({screenSharing:true})], 'current', now).length, 0);
  assert.equal(due([record({screenSharing:true,hiddenSince:now-300000})], 'current', now).length, 1);
});
test('multiple other meetings are retained and own, muted, disconnected and stale tabs are excluded', () => {
  const records=[record({tabId:'one'}), record({tabId:'two'}),record({tabId:'current'}),record({microphoneOn:false}),record({connected:false}),record({at:now-180001}),record({hiddenSince:0})];
  assert.deepEqual(due(records,'current',now).map(x=>x.tabId),['one','two']);
});
test('keep on snoozes only the selected meeting', () => {
  const records=[record({tabId:'one'}),record({tabId:'two'})];
  assert.deepEqual(due(records,'current',now,{one:now+300000}).map(x=>x.tabId),['two']);
  assert.equal(due([record({tabId:'one'})],'current',now,{one:now}).length,1);
});
