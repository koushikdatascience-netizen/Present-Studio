const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const assert = require('node:assert/strict');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function port() { const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const value = server.address().port; await new Promise(resolve => server.close(resolve)); return value; }
(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'snapkey-board-test-'));
  const number = await port(), computePort = await port(); const base = `http://127.0.0.1:${number}`; let logs = '';
  const compute = spawn('python', ['-m', 'uvicorn', 'compute.service:app', '--host', '127.0.0.1', '--port', String(computePort)], { cwd: process.cwd(), env: { ...process.env, COMPUTE_SERVICE_KEY: 'isolated-compute-key' }, windowsHide: true }); compute.stdout.on('data', () => {}); compute.stderr.on('data', data => { logs = (logs + data).slice(-12000); });
  const server = spawn('python', ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(number)], { cwd: path.resolve('backend'), env: { ...process.env, DATABASE_URL: `sqlite:///${path.join(directory, 'test.db').replaceAll('\\', '/')}`, JWT_SECRET: 'isolated-test-secret-not-production', LIVEKIT_URL: '', LIVEKIT_API_KEY: '', LIVEKIT_API_SECRET: '', COMPUTE_SERVICE_URL: `http://127.0.0.1:${computePort}`, COMPUTE_SERVICE_KEY: 'isolated-compute-key', COMPUTE_DAILY_QUOTA: '3', PUBLIC_BASE_URL: base }, windowsHide: true });
  server.stdout.on('data', data => { logs = (logs + data).slice(-12000); }); server.stderr.on('data', data => { logs = (logs + data).slice(-12000); });
  let browser;
  try {
    for (let index = 0; index < 150; index++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {} await sleep(100); if (index === 149) throw new Error(logs); }
    async function api(url, payload, token = '') { const response = await fetch(base + url, { method: payload ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(payload ? { body: JSON.stringify(payload) } : {}) }); const data = await response.json(); assert(response.ok, JSON.stringify(data)); return data; }
    const login = await api('/api/auth/login', { email: 'owner@presentstudio.local', password: 'password123' });
    const created = (await api('/api/presentations', { title: 'Real whiteboard integration' }, login.accessToken)).presentation;
    const share = await api(`/api/presentations/${created.id}/share`, { permission: 'viewer', screenAccessCode: '1234' }, login.accessToken);
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const owner = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await owner.addInitScript(value => { localStorage.setItem('presentStudio.accessToken', value.accessToken); localStorage.setItem('presentStudio.session', JSON.stringify(value.user)); }, login);
    const teacher = await owner.newPage(); const viewerContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const viewer = await viewerContext.newPage(); const errors = [];
    teacher.on('pageerror', error => errors.push(error.message)); viewer.on('pageerror', error => errors.push(error.message));
    for (const page of [teacher, viewer]) await page.route('**/live/media-token', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"Test: audio/video transport intentionally disabled"}' }));
    await teacher.goto(`${base}/controller.html?id=${created.id}`, { waitUntil: 'networkidle' }); await teacher.locator('#controllerControlTab').click(); await teacher.locator('#openWhiteboard').click();
    await teacher.waitForFunction(() => document.querySelector('.science-board-save')?.textContent === 'Saved to meeting');
    await teacher.locator('[data-wb-action="live-math"]').click(); await teacher.locator('[data-live-kind]').selectOption('fraction'); await teacher.locator('[data-live-add]').click();
    await teacher.waitForResponse(response => response.url().includes('/whiteboard') && response.request().method() === 'PUT' && response.status() === 200);
    await viewer.goto(`${base}/screen.html?id=${created.id}&token=${share.token}`, { waitUntil: 'networkidle' });
    await viewer.locator('#screenCode').fill('1234'); await viewer.locator('#screenCode').press('Enter'); await viewer.waitForFunction(() => document.querySelector('#outputStage')?.dataset.kind === 'whiteboard');
    await viewer.locator('#enableScreen').click();
    await viewer.waitForFunction(() => { const canvas = document.querySelector('#outputCanvas'); const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 240 && pixels[i + 1] > 190 && pixels[i + 1] < 230 && pixels[i + 2] < 100) return true; return false; });
    const before = await viewer.locator('#outputCanvas').evaluate(canvas => canvas.toDataURL());
    await teacher.locator('[data-live-numerator]').fill('5'); await viewer.waitForFunction(before => document.querySelector('#outputCanvas').toDataURL() !== before, before);
    const document = await api(`/api/presentations/${created.id}/whiteboard`, null, login.accessToken); assert.equal(document.document.pages[0].scene.objects.find(object => object.wbMath).wbMath.numerator, 5);
    // Socket reconnect must restore the latest document without replaying an old board.
    await viewerContext.setOffline(true); await sleep(500); await teacher.locator('[data-live-numerator]').fill('6'); await teacher.waitForResponse(response => response.url().includes('/whiteboard') && response.request().method() === 'PUT' && response.status() === 200);
    const disconnected = await viewer.locator('#outputCanvas').evaluate(canvas => canvas.toDataURL()); await viewerContext.setOffline(false); await viewer.waitForFunction(previous => document.querySelector('#outputCanvas').toDataURL() !== previous, disconnected, { timeout: 30000 });
    await teacher.locator('[data-live-kind]').selectOption('surface3d'); await teacher.locator('[data-live-add]').click();
    await teacher.waitForFunction(() => document.querySelector('.science-board[open] .wb-live-surface canvas')?.width > 100);
    await viewer.waitForFunction(() => document.querySelector('.wb-live-surface canvas')?.width > 100, { timeout: 30000 });
    const surface = teacher.locator('.science-board[open] .wb-live-surface canvas'); const surfaceImage = await surface.evaluate(canvas => canvas.toDataURL()); assert(surfaceImage.length > 10000, 'Shared surface is blank');
    const bounds = await surface.boundingBox(); await teacher.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await teacher.mouse.down(); await teacher.mouse.move(bounds.x + bounds.width / 2 + 50, bounds.y + bounds.height / 2 + 25, { steps: 8 }); await teacher.mouse.up(); await teacher.waitForFunction(previous => document.querySelector('.science-board[open] .wb-live-surface canvas').toDataURL() !== previous, surfaceImage);
    const output = process.env.MOBILE_SCREENSHOT_DIR || path.resolve('.mobile-screenshots'); fs.mkdirSync(output, { recursive: true });
    await viewer.getByRole('button', { name: 'Expand 3D surface' }).click(); await viewer.waitForFunction(() => Boolean(document.fullscreenElement));
    await viewer.screenshot({ path: path.join(output, 'live-3d-mobile-fullscreen.png') }); await viewer.evaluate(() => document.exitFullscreen());
    await teacher.locator('[data-wb-action="advanced"]').click(); await teacher.locator('[data-advanced-run]').click(); await teacher.waitForFunction(() => document.querySelector('[data-advanced-result]').textContent === '3*x**2 + 4*x - 4'); assert((await teacher.locator('[data-advanced-status]').textContent()).includes('symbolically-checked'));
    await teacher.screenshot({ path: path.join(output, 'verified-derivative.png') });
    await teacher.locator('[data-wb-action="lessons"]').click(); await teacher.locator('[data-lesson-id="area"]').click(); await teacher.waitForFunction(() => document.querySelector('[data-live-kind]').value === 'integral');
    await teacher.locator('[data-live-play]').click(); await teacher.waitForFunction(() => document.querySelector('[data-live-play]').getAttribute('aria-pressed') === 'true'); await sleep(1200); await teacher.locator('[data-live-play]').click();
    await teacher.screenshot({ path: path.join(output, 'live-shared-desktop.png') }); await viewer.screenshot({ path: path.join(output, 'live-shared-mobile.png') });
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('Passed: real isolated backend and computation worker; teacher-to-mobile Socket.IO updates; reconnect; shared Three.js surface/orbit/fullscreen; verified derivative; lesson templates/animation. AV transport intentionally not tested.');
  } finally {
    await browser?.close(); for (const process of [server, compute]) if (process.exitCode === null) { const exited = new Promise(resolve => process.once('exit', resolve)); process.kill(); await exited; } if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected test directory'); fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
