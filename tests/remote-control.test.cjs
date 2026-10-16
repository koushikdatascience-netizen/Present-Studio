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
const vm = require('node:vm');
const fs = require('node:fs');
function guestUi(role = 'guest') {
  const nodes = [];
  class Element {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.style = {}; this.parentNode = null; this.textContent = ''; nodes.push(this); }
    append(...children) { for (const child of children) { child.parentNode = this; this.children.push(child); } }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(c => c !== this); this.parentNode = null; }
    setAttribute() {}
    get isConnected() { return this === body || Boolean(this.parentNode?.isConnected); }
  }
  const body = new Element('body');
  const listeners = {};
  let tick, resolveTicket;
  const alerts = [];
  const context = {
    document: { body, createElement: tag => new Element(tag), addEventListener() {} },
    location: { origin: 'https://connect.snapkeystudio.com' }, URL, Blob,
    setInterval(fn) { tick = fn; return 1; }, clearInterval() {}, setTimeout() {},
    fetch: () => new Promise(resolve => { resolveTicket = resolve; }),
    performance: { now: () => 1000 },
  };
  context.window = { addEventListener() {}, alert: message => alerts.push(message) };
  vm.runInNewContext(fs.readFileSync(require.resolve('../frontend/js/remote-control.js'), 'utf8'), context);
  const socket = { connected: true, on(name, fn) { listeners[name] = fn; }, emit(name, data, callback) { if (name === 'remote_control_bind') callback({ credential: 'test-credential', role }); } };
  context.window.SnapKeyRemoteControl.create({ socket, connected: () => true, sharing: () => true, presentationId: 'p' });
  tick();
  return { nodes, listeners, alerts, resolve: value => resolveTicket({ ok: true, json: async () => value }), state: { id: 'session', state: 'requested', ownerName: 'Owner' } };
}
test('control buttons have explicit contrast and visible keyboard focus', () => {
  const h = guestUi(); h.listeners.remote_control_status(h.state);
  const button = h.nodes.find(n => n.textContent === 'Prepare Helper Pairing');
  assert.equal(button.style.color, '#ffffff');
  assert.equal(button.style.background, '#075985');
  button.onfocus(); assert.equal(button.style.outline, '3px solid #fbbf24');
});
test('owner pending state explains native helper approval requirement', () => {
  const h = guestUi('owner'); h.listeners.remote_control_status({ ...h.state, state: 'paired' });
  assert.ok(h.nodes.some(n => n.isConnected && n.textContent.includes('click Allow Control inside its native window')));
});
for (const statusArrivesFirst of [true, false]) {
  test('pairing text survives REST/socket status race: status first=' + statusArrivesFirst, async () => {
    const h = guestUi(); h.listeners.remote_control_status(h.state);
    const prepare = h.nodes.find(n => n.textContent === 'Prepare Helper Pairing');
    const click = prepare.onclick();
    await Promise.resolve();
    if (statusArrivesFirst) h.listeners.remote_control_status({ ...h.state, state: 'pairing' });
    h.resolve({ ticket: 'one-time-private-ticket' });
    await click;
    if (!statusArrivesFirst) h.listeners.remote_control_status({ ...h.state, state: 'pairing' });
    const fields = h.nodes.filter(n => n.tagName === 'INPUT' && n.isConnected);
    assert.equal(fields.length, 1);
    assert.equal(fields[0].value, 'https://connect.snapkeystudio.com/#one-time-private-ticket');
    assert.equal(h.alerts.length, 0);
  });
}
