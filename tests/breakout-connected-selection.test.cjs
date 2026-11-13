const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('frontend/js/breakout-rooms.js', 'utf8');
const helper = source.slice(source.indexOf('    async function confirmMove('), source.indexOf('    function render()'));
test('manual group move excludes offline and unknown-presence participants', async () => {
  const moved = [];
  const ctx = {state:{participants:[{id:'online',connected:true},{id:'offline',connected:false},{id:'unknown',connected:true,presenceKnown:false}]}, ask:async () => true, command:(...args) => moved.push(args)};
  vm.createContext(ctx); vm.runInContext(helper,ctx);
  await ctx.confirmMove(['online','offline','unknown'],{id:'room',name:'Room'});
  assert.equal(moved.length,1);
  assert.deepEqual(Array.from(moved[0][1].guestIds), ['online']);
});
test('stale selection with no connected participants does not offer or send a move', async () => {
  const ctx = {state:{participants:[{id:'left',connected:false}]}, ask:async () => {throw Error('Unexpected confirmation');}, command:() => {throw Error('Unexpected move');}};
  vm.createContext(ctx); vm.runInContext(helper,ctx);
  await ctx.confirmMove(['left'],{id:'room',name:'Room'});
});
