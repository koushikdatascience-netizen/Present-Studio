const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const assert = require('node:assert/strict');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() { const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const value = server.address().port; await new Promise(resolve => server.close(resolve)); return value; }
const fakeRoom = `
(() => {
  const sdk = window.LivekitClient;
  class Room {
    constructor() {
      this.events = new Map(); this.remoteParticipants = new Map(); this.canPlayAudio = true;
      this.localParticipant = {identity: '', name: '', metadata: '', trackPublications: new Map(),
        isMicrophoneEnabled: false, isCameraEnabled: false, isScreenShareEnabled: false,
        setMicrophoneEnabled: async value => {this.localParticipant.isMicrophoneEnabled = value;},
        setCameraEnabled: async value => {this.localParticipant.isCameraEnabled = value;},
        setScreenShareEnabled: async value => {this.localParticipant.isScreenShareEnabled = value;},
        getTrackPublication: () => undefined};
    }
    on(name, callback) { const listeners = this.events.get(name) || []; listeners.push(callback); this.events.set(name, listeners); return this; }
    async startAudio() {}
    async connect(url, token) { const data = JSON.parse(atob(token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/'))); Object.assign(this.localParticipant, {identity: data.sub, name: data.name, metadata: data.metadata}); }
    disconnect() { for (const listener of this.events.get(sdk.RoomEvent.Disconnected) || []) listener(); }
  }
  window.LivekitClient = {...sdk, Room};
})();
`;
(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'snapkey-breakout-test-'));
  const port = await freePort(); const base = `http://127.0.0.1:${port}`; let logs = '';
  const server = spawn('python', ['-m', 'uvicorn', 'breakout_test_app:app', '--app-dir', 'tests', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: path.resolve('backend'), windowsHide: true, env: {...process.env, DATABASE_URL: `sqlite:///${path.join(directory, 'test.db').replaceAll('\\', '/')}`,
      JWT_SECRET: 'isolated-breakout-fixture-secret', LIVEKIT_URL: 'wss://fixture.invalid', LIVEKIT_API_KEY: 'test-key', LIVEKIT_API_SECRET: 'test-secret', PUBLIC_BASE_URL: base}
  });
  server.stdout.on('data', data => { logs = (logs + data).slice(-15000); }); server.stderr.on('data', data => { logs = (logs + data).slice(-15000); });
  let browser;
  try {
    for (let i = 0; i < 150; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {} await pause(100); if (i === 149) throw new Error(logs); }
    async function api(url, data, token = '') {
      const response = await fetch(base + url, {method: data ? 'POST' : 'GET', headers: {'Content-Type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {})}, ...(data ? {body: JSON.stringify(data)} : {})});
      const result = await response.json(); assert(response.ok, JSON.stringify(result)); return result;
    }
    const login = await api('/api/auth/login', {email: 'owner@presentstudio.local', password: 'password123'});
    const meeting = await api('/api/meetings', {title: 'Breakout acceptance', timingMode: 'instant', durationMode: 'unlimited', accessType: 'public'}, login.accessToken);
    const guest = await api('/__test/guest', {presentationId: meeting.presentationId, guestId: 'guest-browser', name: 'Student with a longer name'}, login.accessToken);
    browser = await chromium.launch({channel: 'chrome', headless: true});
    const ownerContext = await browser.newContext({viewport: {width: 1440, height: 900}});
    await ownerContext.addInitScript(value => {localStorage.setItem('presentStudio.accessToken', value.accessToken); localStorage.setItem('presentStudio.session', JSON.stringify(value.user));}, login);
    const mobileContext = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});
    const owner = await ownerContext.newPage(), student = await mobileContext.newPage(); const errors = [];
    for (const page of [owner, student]) {
      page.on('pageerror', error => errors.push(error.message));
      page.on('dialog', dialog => dialog.type() === 'prompt' ? dialog.accept('Science group') : dialog.accept());
      await page.route('**/js/live-media.js?*', async route => { const response = await route.fetch(); await route.fulfill({response, body: fakeRoom + await response.text()}); });
    }
    await owner.goto(`${base}/controller.html?id=${meeting.presentationId}`);
    await owner.locator('#controllerInteractiveTab').click();
    await owner.locator('[data-live-tab="rooms"]').click();
    await owner.getByRole('button', {name: 'Create room', exact: true}).click();
    await owner.getByLabel('Room name', {exact: true}).fill('Science group');
    await owner.getByRole('button', {name: 'Create', exact: true}).click();
    await owner.locator('.breakout-room strong').filter({hasText: 'Science group'}).waitFor();
    await student.goto(`${base}/present.html?id=${meeting.presentationId}&resume=${encodeURIComponent(guest.resume)}`);
    await student.waitForFunction(() => document.querySelector('#presentLiveMedia').classList.contains('is-connected'));
    await student.locator('[data-live-tab="rooms"]').click();
    await student.locator('[data-live-microphone]').click();
    await owner.locator('.breakout-person select').selectOption({label: 'Science group'});
    await owner.getByRole('button', {name: 'Move', exact: true}).click();
    await student.waitForURL(url => url.searchParams.get('id') !== meeting.presentationId);
    const childId = new URL(student.url()).searchParams.get('id');
    await student.waitForFunction(() => document.querySelector('#presentLiveMedia').classList.contains('is-connected'));
    await student.locator('[data-live-tab="rooms"]').click();
    await student.waitForFunction(() => document.querySelector('.breakout-status')?.textContent.includes('Science group'));
    assert.equal(await student.locator('[data-live-microphone]').getAttribute('aria-pressed'), 'true');
    assert((await student.locator('.breakout-status').textContent()).includes('Science group'));
    assert.equal(await student.locator('.breakout-person').count(), 0);
    assert.equal(await student.locator('[data-live-tab="rooms"]').evaluate(node => node.getBoundingClientRect().right <= window.innerWidth), true);
    const output = process.env.MOBILE_SCREENSHOT_DIR;
    if (output) { fs.mkdirSync(output, {recursive: true}); await student.screenshot({path: path.join(output, 'breakout-mobile.png')}); await owner.screenshot({path: path.join(output, 'breakout-desktop.png')}); }
    const group = owner.locator('.breakout-room').filter({has: owner.locator('strong', {hasText: 'Science group'})});
    await group.getByRole('button', {name: 'Join', exact: true}).click();
    await owner.waitForURL(url => url.searchParams.get('id') === childId);
    await owner.locator('#controllerInteractiveTab').click();
    await owner.locator('[data-live-tab="rooms"]').click();
    await owner.getByRole('button', {name: 'Create room', exact: true}).waitFor();
    const mainDrop = owner.locator('.breakout-room').filter({has: owner.locator('strong', {hasText: 'Main room'})});
    await owner.locator('.breakout-person').dragTo(mainDrop);
    await owner.getByRole('button', {name: 'Move', exact: true}).click();
    await student.waitForURL(url => url.searchParams.get('id') === meeting.presentationId);
    await owner.locator('.breakout-person select').selectOption({label: 'Science group'});
    await owner.getByRole('button', {name: 'Move', exact: true}).click();
    await student.waitForURL(url => url.searchParams.get('id') === childId);
    await student.waitForFunction(() => document.querySelector('#presentLiveMedia').classList.contains('is-connected'));
    await student.locator('[data-live-tab="rooms"]').click();
    await student.getByRole('button', {name: 'Return to main room', exact: true}).click();
    await student.waitForURL(url => url.searchParams.get('id') === meeting.presentationId);
    await student.waitForFunction(() => document.querySelector('#presentLiveMedia').classList.contains('is-connected'));
    assert.equal(await student.locator('[data-live-microphone]').getAttribute('aria-pressed'), 'true');
    const main = owner.locator('.breakout-room').filter({has: owner.locator('strong', {hasText: 'Main room'})});
    await main.getByRole('button', {name: 'Join', exact: true}).click();
    await owner.waitForURL(url => url.searchParams.get('id') === meeting.presentationId);
    await owner.locator('#controllerInteractiveTab').click(); await owner.locator('[data-live-tab="rooms"]').click();
    await owner.getByRole('button', {name: 'Close all rooms', exact: true}).click();
    await owner.getByRole('button', {name: 'Close rooms', exact: true}).click();
    await owner.waitForFunction(() => document.querySelector('.breakout-status')?.textContent.includes('closing'));
    await pause(32000);
    await owner.waitForFunction(() => document.querySelectorAll('.breakout-room').length === 1);
    assert.deepEqual(errors, []);
    console.log('Passed: real Socket.IO/DB authorization; mobile assignment and microphone preference; isolated child state; owner visits; return to main; persisted closure countdown. LiveKit transport is mocked.');
  } finally {
    await browser?.close(); if (server.exitCode === null) {const exited = new Promise(resolve => server.once('exit', resolve)); server.kill(); await exited;}
    const resolved = path.resolve(directory); if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('snapkey-breakout-test-')) throw new Error('Unexpected test directory');
    fs.rmSync(resolved, {recursive: true, force: true});
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
