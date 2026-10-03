const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const output = process.env.MOBILE_SCREENSHOT_DIR || path.resolve('.mobile-screenshots');
fs.mkdirSync(output, { recursive: true });
const presentation = { id: 'pres_mobile', ownerId: 'owner', title: 'Team workshop', slides: Array.from({ length: 6 }, (_, index) => ({ id: `slide_${index}`, title: `Session ${index + 1}`, canvas: { background: '#111214', elements: [{ id: `image_${index}`, type: 'image', src: '/assets/login-office.jpg', full_bleed: true, width: 100, height: 100, fit: 'contain' }] } })) };

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await context.addInitScript(() => {
      localStorage.setItem('presentStudio.accessToken', 'layout-test');
      localStorage.setItem('presentStudio.session', JSON.stringify({ id: 'owner', name: 'Koushik' }));
    });
    const page = await context.newPage();
    const errors = [];
    let fixtureKind = 'slide';
    await page.route('**/assets/login-office.jpg', route => route.fulfill({ contentType: 'image/webp', body: fs.readFileSync(path.resolve('frontend/assets/login-office.jpg')) }));
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*socket.io.min.js', route => route.fulfill({ contentType: 'application/javascript', body: 'window.testEvents=[];window.testHandlers={};window.io=()=>({connected:true,on(type,handler){window.testHandlers[type]=handler;return this},off(){return this},emit(type,payload){window.testEvents.push({type,payload});return this}});' }));
    await page.route('**/*livekit-client.umd.min.js', route => route.fulfill({ contentType: 'application/javascript', body: 'window.LivekitClient={};' }));
    await page.route('**/api/**', route => {
      const url = route.request().url();
      let body = {};
      let status = 200;
      if (url.includes('media-token')) { body = { detail: 'Layout fixture: media connection disabled' }; status = 503; }
      else if (new URL(url).pathname === '/api/presentations') body = { presentations: [presentation, { ...presentation, id: 'youtube', title: 'YouTube session', slides: [{ canvas: { fabric: { objects: [{ type: 'rect', mediaType: 'youtube', youtubeId: 'dQw4w9WgXcQ', src: 'https://youtu.be/dQw4w9WgXcQ', left: 0, top: 0, width: 1280, height: 720 }] } } }] }] };
      else if (new URL(url).pathname === '/api/meetings') body = { meetings: [] };
      else if (url.includes('/api/meetings/')) body = { id: 'meeting', status: 'ready', accessType: 'public', durationMode: 'unlimited' };
      else if (url.includes('/live')) body = { presentationId: presentation.id, activeSlideId: 'slide_0', slideId: 'slide_0', kind: fixtureKind, playing: false, videoVolume: 1, audioVolume: 1, isLive: true };
      else if (url.includes('/api/presentations/')) body = { presentation, permission: 'presenter' };
      else if (url.includes('/auth/me')) body = { user: { id: 'owner', name: 'Koushik' } };
      return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto('http://127.0.0.1:8877/controller.html?id=pres_mobile', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelector('#controllerTitle').textContent.includes('Team workshop'));
    await page.locator('#controllerControlTab').click();
    await page.locator('#openWhiteboard').click();
    assert(await page.locator('#previewWhiteboardSurface').isVisible());
    assert(await page.locator('#previewFullscreenTools').isVisible());
    assert(await page.evaluate(() => window.testEvents.some(event => event.type === 'controller_state' && event.payload.kind === 'whiteboard')), 'Whiteboard mode not broadcast');
    const board = await page.locator('#controllerPreviewVisual').boundingBox();
    await page.mouse.move(board.x + 30, board.y + 30);
    await page.mouse.down();
    await page.mouse.move(board.x + 120, board.y + 70, { steps: 8 });
    await page.mouse.up();
    assert(await page.evaluate(() => window.testEvents.some(event => event.type === 'annotation_event' && event.payload.type === 'draw')), 'Inline drawing not broadcast');
    await page.screenshot({ path: path.join(output, 'whiteboard-mobile.png'), fullPage: true });
    await page.locator('#previewClearAnnotations').click();
    assert(await page.locator('#previewAnnotationCanvas').evaluate(canvas => !canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some(value => value)), 'Whiteboard clear failed');
    await page.locator('#openWhiteboard').click();
    assert(!(await page.locator('#previewWhiteboardSurface').isVisible()));
    for (const [width, height] of [[320, 740], [390, 844], [430, 932], [844, 390]]) {
      await page.setViewportSize({ width, height });
      await page.locator('#controllerControlTab').click();
      await page.screenshot({ path: path.join(output, `control-${width}.png`), fullPage: true });
      const control = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth, previewHeight: document.querySelector('#previewStage').getBoundingClientRect().height, gap: document.querySelector('.controller-console-sidebar').getBoundingClientRect().top - document.querySelector('#previewStage').getBoundingClientRect().bottom }));
      assert(control.width <= width + 1, `Control overflow at ${width}: ${control.width}`);
      assert(control.previewHeight < 500, `Oversized mobile preview at ${width}`);
      assert(control.gap < 80, `Blank space below preview at ${width}: ${control.gap}`);
      await page.locator('#controllerInteractiveTab').click();
      await page.evaluate(() => {
        const root = document.querySelector('#controllerLiveMedia');
        root.classList.add('is-connected');
        root.querySelectorAll('.live-control-button').forEach(button => { button.disabled = false; });
        root.querySelector('[data-live-count]').textContent = '6 connected';
        root.querySelector('[data-live-tiles]').innerHTML = '<div class="live-participant-group"><header class="live-participant-group-heading">Audience</header><div class="live-participant-group-grid">' + ['Koushik', 'Saumya', 'Ananya', 'Rahul', 'Priya', 'Arjun'].map(name => `<article class="live-media-tile"><div class="live-media-tile-video"><span class="live-media-avatar">${name[0]}</span></div><footer><strong>${name}</strong><span>Audience</span></footer></article>`).join('') + '</div></div>';
      });
      await page.screenshot({ path: path.join(output, `interactive-${width}.png`), fullPage: true });
      const dock = await page.locator('.interactive-control-dock').boundingBox();
      assert(dock.y + dock.height <= height + 1, `Dock outside viewport at ${width}`);
      assert.equal(await page.locator('.interactive-control-dock > .live-control-button:visible').count(), 5);
      await page.locator('[data-live-more-toggle]').click();
      assert(await page.locator('#controllerRecordButton').isVisible(), 'Record missing from More');
      assert(await page.locator('[data-live-mute-all]').isVisible(), 'Mute all missing from More');
      await page.locator('[data-live-mute-all]').scrollIntoViewIfNeeded();
      assert(await page.locator('[data-live-mute-all]').evaluate(button => {
        const rect = button.getBoundingClientRect();
        return button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
      }), 'Participant panel covers More menu actions');
      const menu = await page.locator('[data-live-more-menu]').boundingBox();
      assert(menu.x >= 0 && menu.x + menu.width <= width + 1 && menu.y >= 0 && menu.y + menu.height <= height, `More menu clipped at ${width}`);
      await page.screenshot({ path: path.join(output, `more-${width}.png`), fullPage: true });
      await page.locator('[data-live-more-toggle]').click();
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    assert(await page.locator('.interactive-control-dock > #controllerRecordButton').count(), 'Desktop actions not restored');
    await page.screenshot({ path: path.join(output, 'desktop-interactive.png'), fullPage: true });
    fixtureKind = 'whiteboard';
    await page.goto('http://127.0.0.1:8877/screen.html?id=pres_mobile', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelector('#outputStage').dataset.kind === 'whiteboard');
    assert(await page.locator('#outputCanvasWrap').isVisible(), 'Audience whiteboard is hidden');
    assert(await page.locator('#outputCanvasWrap canvas').first().evaluate(canvas => canvas.getContext('2d').getImageData(640, 360, 1, 1).data[0] === 255), 'Audience board background is not white');
    await page.evaluate(() => window.testHandlers.presentation_state({ presentationId: 'pres_mobile', slideId: 'slide_0', kind: 'slide', playing: false }));
    await page.waitForFunction(() => document.querySelector('#outputStage').dataset.kind === 'slide');
    fixtureKind = 'slide';
    await page.goto('http://127.0.0.1:8877/dashboard.html', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => {
      const canvas = document.querySelector('[data-deck-thumbnail="pres_mobile"]');
      return canvas && canvas.getContext('2d').getImageData(640, 360, 1, 1).data[0] < 240;
    });
    assert.equal(await page.locator('[data-deck-thumbnail]').count(), 2);
    assert((await page.locator('.dashboard-slide-media').getAttribute('src')).includes('i.ytimg.com/vi/dQw4w9WgXcQ'));
    await page.screenshot({ path: path.join(output, 'dashboard-thumbnails.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Dashboard mobile overflow');
    await page.screenshot({ path: path.join(output, 'dashboard-thumbnails-mobile.png'), fullPage: true });
    assert.deepEqual(errors, [], `Browser errors: ${errors.join('; ')}`);
    console.log('Mobile layouts, dashboard image/YouTube previews, inline whiteboard drawing/clear/broadcast and audience whiteboard restore passed.');
    console.log(`Screenshots: ${output}`);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
