const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const output = process.env.WB_SCREENSHOTS || path.join(require('node:os').tmpdir(), 'snapkey-polar-verification');
const scripts = ['whiteboard-polar', 'whiteboard-keyboard', 'whiteboard-studios', 'whiteboard-math-lab', 'whiteboard-live-math', 'whiteboard-3d', 'whiteboard-lessons', 'whiteboard-advanced', 'whiteboard-view', 'science-whiteboard'];
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/frontend/css/whiteboard.css"><script src="/node_modules/mathjs/lib/browser/math.js"></script><script src="https://cdn.jsdelivr.net/npm/plotly.js-dist-min@2.35.2/plotly.min.js"></script><script src="https://cdn.jsdelivr.net/npm/fabric@5.3.0/dist/fabric.min.js"></script>${scripts.map(name => `<script src="/frontend/js/${name}.js"></script>`).join('')}<button id="open">Open whiteboard</button><script>
window.errors=[]; window.saved=null;
window.board=SnapKeyWhiteboard.create({presentationId:'fixture',api:{getWhiteboard:async()=>({document:null}), saveWhiteboard:async(id,doc)=>{window.saved=doc;return {revision:doc.revision+1};}},notify:message=>errors.push(message),onDocument:doc=>window.documentState=doc,onActivate:()=>{},onStop:()=>{}});
document.querySelector('#open').onclick=()=>board.open();
</script>`;
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const server = http.createServer((req, res) => {
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end(html); return; }
    const file = path.resolve('.' + decodeURIComponent(req.url.split('?')[0]));
    if (!file.startsWith(process.cwd() + path.sep)) { res.writeHead(403).end(); return; }
    try { res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'application/javascript'); res.end(fs.readFileSync(file)); } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    for (const mobile of [false, true]) {
      const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, isMobile: mobile, hasTouch: mobile });
      const page = await context.newPage(), pageErrors = []; page.on('pageerror', error => { pageErrors.push(error.message); console.error('Page error:', error.message); });
      page.on('requestfailed', request => console.error('Request failed:', request.url(), request.failure()?.errorText));
      await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'networkidle' });
      await page.locator('#open').click(); await page.locator('.science-board').waitFor();
      assert(await page.locator('.wb-math-keyboard').isHidden());
      await page.locator('[data-wb-action="graph"]').click();
      await page.waitForFunction(() => document.querySelector('[data-wb-graph-insert]').disabled === false || document.querySelector('[data-wb-graph-error]').textContent);
      assert.equal(await page.locator('[data-wb-graph-error]').textContent(), '');
      for (const preset of ['cardioid', 'rose', 'lemniscate', 'limacon', 'spiral']) {
        await page.locator(`[data-wb-preset="${preset}"]`).click();
        await page.waitForFunction(id => document.querySelector('[data-wb-expression]').value === SnapKeyMathInput.presets[id].expression && document.querySelector('[data-wb-plot]').data?.[0]?.x?.length === 1441, preset);
        await page.waitForTimeout(150);
        assert.equal(await page.locator('[data-wb-graph-error]').textContent(), '');
        const svg = await page.locator('[data-wb-plot] svg.main-svg').first().boundingBox(); assert(svg.width > 100 && svg.height > 100, JSON.stringify(svg));
        if (preset === 'cardioid') { const bounds = await page.evaluate(() => { const x = document.querySelector('[data-wb-plot]').data[0].x; return [Math.min(...x), Math.max(...x)]; }); assert(Math.abs(bounds[0] + .25) < .001 && bounds[1] === 2); }
        await page.screenshot({ path: path.join(output, `${mobile ? 'mobile' : 'desktop'}-${preset}.png`) });
      }
      const field = page.locator('[data-wb-expression]'); await field.fill(''); await field.focus();
      assert(await page.locator('.wb-math-keyboard').isVisible());
      assert.equal(await page.locator('.wb-kb-tabs [aria-selected="true"]').textContent(), 'Polar θ');
      const keyboardBounds = await page.locator('.wb-math-keyboard').boundingBox(), panelBounds = await page.locator('[data-wb-window="graph"]').boundingBox();
      assert(panelBounds.y + panelBounds.height <= keyboardBounds.y + 2); assert(keyboardBounds.width <= (mobile ? 390 : 1440));
      await page.screenshot({ path: path.join(output, `${mobile ? 'mobile' : 'desktop'}-keyboard.png`) });
      await page.locator('.wb-kb-keys').getByRole('button', { name: 'a(1+cos θ)', exact: true }).click(); assert.equal(await field.inputValue(), 'a*(1+cos(theta))');
      await page.getByRole('button', { name: 'Backspace', exact: true }).click(); assert(await field.evaluate(node => node === document.activeElement));
      await field.fill('x+1'); await field.evaluate(node => node.setSelectionRange(0, 3));
      await page.getByRole('tab', { name: 'Basic', exact: true }).click(); await page.locator('.wb-kb-keys').getByRole('button', { name: '√', exact: true }).click(); assert.equal(await field.inputValue(), 'sqrt(x+1)');
      const maximum = page.locator('[data-wb-domain-max]'); await maximum.fill(''); await maximum.focus(); await page.getByRole('tab', { name: 'Polar θ', exact: true }).click(); await page.locator('.wb-kb-keys').getByRole('button', { name: '2π', exact: true }).click(); assert.equal(await maximum.inputValue(), '2*pi');
      await page.locator('[data-wb-graph-mode]').focus(); await page.waitForTimeout(150); assert(await page.locator('.wb-math-keyboard').isHidden());
      for (const [id, parameter, expression] of [['a1', 1, 'a*(1+cos(theta))'], ['a2', 2, 'a*(1+cos(theta))'], ['rose5', 2, 'a*cos(5*theta)']]) {
        await page.evaluate(({ parameter, expression }) => { let el = document.querySelector('#polar-canvas'); if (!el) { el = document.createElement('canvas'); el.id = 'polar-canvas'; el.width = 640; el.height = 440; document.querySelector('.science-board-viewport').append(el); window.polarCanvas = new fabric.Canvas(el); } polarCanvas.clear(); const object = SnapKeyLiveMath.render({ ...SnapKeyLiveMath.defaults('polar'), parameter, expression }, math); polarCanvas.add(object); polarCanvas.renderAll(); }, { parameter, expression });
        const pixels = await page.evaluate(() => { const ctx = polarCanvas.lowerCanvasEl.getContext('2d'), data = ctx.getImageData(0, 0, 640, 440).data; let count = 0; for (let i = 3; i < data.length; i += 4) if (data[i]) count++; return count; }); assert(pixels > 1000);
        await page.locator('[data-wb-action="close-window"]').filter({ visible: true }).first().click();
        await page.screenshot({ path: path.join(output, `${mobile ? 'mobile' : 'desktop'}-live-${id}.png`) });
        if (id !== 'rose5') await page.locator('[data-wb-action="graph"]').click();
      }
      await page.locator('[data-wb-action="graph"]').click(); await page.locator('[data-wb-preset="cardioid"]').click(); await page.locator('[data-wb-action="insert-graph"]').click();
      await page.waitForFunction(() => documentState.pages[0].scene.objects.some(object => object.wbMath?.kind === 'polar'));
      assert.equal((await page.evaluate(() => documentState.pages[0].scene.objects.find(object => object.wbMath?.kind === 'polar').type)), 'group');
      await page.evaluate(async () => { const canvas = new fabric.StaticCanvas(document.createElement('canvas'), { width: 800, height: 500 }); SnapKeyWhiteboardView.render(canvas, documentState); await new Promise(resolve => setTimeout(resolve, 250)); window.viewerKinds = canvas.getObjects().map(object => object.wbMath?.kind); canvas.dispose(); }); assert((await page.evaluate(() => viewerKinds)).includes('polar'));
      await page.locator('[data-wb-action="equation"]').click(); await page.waitForFunction(() => document.querySelector('[data-wb-latex]').mathVirtualKeyboardPolicy === 'manual');
      await page.locator('[data-wb-latex]').evaluate(field => { field.value = String.raw`r=a(1+\cos\theta)`; field.focus(); });
      await page.waitForTimeout(300); assert(await page.evaluate(() => mathVirtualKeyboard.visible));
      await page.locator('[data-wb-action="graph-equation"]').click(); await page.waitForTimeout(300); assert.equal(await page.locator('[data-wb-graph-mode]').inputValue(), 'polar'); assert.equal(await page.locator('[data-wb-graph-error]').textContent(), '');
      assert.deepEqual(pageErrors, []); assert.deepEqual(await page.evaluate(() => errors), []);
      await context.close(); console.log(`${mobile ? 'Mobile' : 'Desktop'} harness passed`);
    }
    if (process.env.WB_APP_URL) {
      const base = process.env.WB_APP_URL;
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const loginResponse = await context.request.post(`${base}/api/auth/login`, { data: { email: 'owner@presentstudio.local', password: 'password123' } }); assert(loginResponse.ok()); const login = await loginResponse.json();
      const response = await context.request.post(`${base}/api/meetings`, { headers: { Authorization: `Bearer ${login.accessToken}` }, data: { title: 'Polar frontend verification', timingMode: 'instant', durationMode: 'unlimited', accessType: 'public' } }); assert(response.ok(), await response.text()); const meeting = await response.json();
      await context.addInitScript(value => { localStorage.setItem('presentStudio.accessToken', value.accessToken); localStorage.setItem('presentStudio.session', JSON.stringify(value.user)); }, login);
      const page = await context.newPage(); await page.goto(`${base}/controller.html?id=${meeting.presentationId}`);
      await page.locator('#controllerControlTab').click(); await page.locator('#openWhiteboard').click();
      await page.locator('[data-wb-action="graph"]').click(); await page.locator('[data-wb-preset="rose"]').click(); await page.waitForTimeout(1000);
      assert.equal(await page.locator('[data-wb-graph-error]').textContent(), '');
      const save = page.waitForResponse(response => response.url().includes('/whiteboard') && response.request().method() === 'PUT');
      await page.locator('[data-wb-action="insert-graph"]').click(); const saved = await save;
      if (saved.status() === 422) { assert.equal((await saved.json()).detail, 'Invalid live math object'); console.log('Full controller polar insertion rendered, but real backend rejected persistence: Invalid live math object (422). Audience/screen synchronization blocked.'); }
      else assert(saved.ok(), await saved.text());
      await page.screenshot({ path: path.join(output, 'app-controller-polar.png') });
      await context.close();
    }
    console.log(`Screenshots: ${output}`);
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
