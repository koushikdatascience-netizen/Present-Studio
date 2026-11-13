const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('frontend/js/present.js', 'utf8');
const helper = source.slice(source.indexOf('async function redirectMeetingOwner()'), source.indexOf('async function init()'));
function context(overrides = {}) {
  const calls = [];
  const ctx = { audienceJoinLink: true, participantResumeToken: '', shareToken: 'private/link', authToken: 'signed-in',
    fetch: async (...args) => { calls.push(args); return { ok: true, json: async () => ({isOwner: true, presentationId: 'meeting-1'}) }; },
    location: { replace: value => calls.push(value) }, ...overrides };
  vm.createContext(ctx); vm.runInContext(helper, ctx);
  return {ctx, calls};
}
test('verified owner follows shared link to existing presenter flow with identity', async () => {
  const {ctx, calls} = context();
  assert.equal(await ctx.redirectMeetingOwner(), true);
  assert.equal(calls[0][0], '/api/presentations/shared/private%2Flink/owner');
  assert.equal(calls[0][1].headers.Authorization, 'Bearer signed-in');
  assert.equal(calls[0][1].credentials, 'include');
  assert.equal(calls[1], '/controller.html?id=meeting-1');
});
test('guest or non-owner stays in audience flow', async () => {
  const {ctx, calls} = context({fetch: async () => ({ok:true,json:async () => ({isOwner:false})})});
  assert.equal(await ctx.redirectMeetingOwner(), false); assert.equal(calls.length, 0);
});
test('audience resume and presenter URLs retain their explicit roles', async () => {
  for (const override of [{participantResumeToken:'resume-token'}, {audienceJoinLink:false}]) {
    const {ctx,calls} = context(override);
    assert.equal(await ctx.redirectMeetingOwner(), false); assert.equal(calls.length,0);
  }
});
