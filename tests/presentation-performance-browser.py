"""Real-browser regressions for independent loading and editor races."""
import asyncio
import base64
from io import BytesIO
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
from uuid import uuid4

from PIL import Image
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]


async def run():
    with tempfile.TemporaryDirectory(prefix="presentstudio-browser-") as directory:
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        base = f"http://127.0.0.1:{port}"
        env = {**os.environ, "DATABASE_URL": "sqlite:///" + (Path(directory) / "test.db").as_posix(),
               "PUBLIC_BASE_URL": base, "STORAGE_PROVIDER": "cloudinary", "JWT_SECRET": "isolated-browser-test-secret",
               "LIVEKIT_URL": "", "LIVEKIT_API_KEY": "", "LIVEKIT_API_SECRET": ""}
        server = subprocess.Popen([os.sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(port)],
                                  cwd=ROOT / "backend", env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                  creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        try:
            async with async_playwright() as playwright:
                api = await playwright.request.new_context(base_url=base)
                for _ in range(300):
                    try:
                        if (await api.get("/api/health")).ok:
                            break
                    except Exception:
                        pass
                    await asyncio.sleep(0.1)
                else:
                    raise RuntimeError("Test server did not start")
                result = await api.post("/api/auth/signup", data={"name": "Browser Owner", "email": uuid4().hex + "@example.com", "password": "securepass123"})
                auth = await result.json()
                headers = {"Authorization": "Bearer " + auth["accessToken"]}
                deck = (await (await api.post("/api/presentations", headers=headers, data={"title": "Performance browser deck"})).json())["presentation"]
                slides = []
                for index in range(3):
                    slides.append({"id": "slide_" + uuid4().hex, "order": index + 1, "title": f"Slide {index + 1}",
                                   "canvas": {"background": "#fff", "fabric": {"version": "5.3.0", "objects": [
                                       {"id": "title", "type": "textbox", "text": ["First slide", "Second slide", "Third slide"][index],
                                        "left": 100, "top": 100, "width": 600, "fontSize": 40, "styles": {}}]}}})
                slides[1]["canvas"]["fabric"]["objects"].append({"id": "slow", "type": "image", "mediaType": "image", "src": base + "/slow-image.png", "width": 800, "height": 600, "left": 400, "top": 250, "scaleX": 0.5, "scaleY": 0.5})
                deck["slides"] = slides
                response = await api.put(f"/api/presentations/{deck['id']}", headers=headers, data=deck)
                assert response.ok, await response.text()
                buffer = BytesIO()
                Image.new("RGB", (800, 600), "red").save(buffer, format="PNG")
                png = buffer.getvalue()
                browser = await playwright.chromium.launch(headless=True, channel=os.environ.get('PERF_BROWSER_CHANNEL') or None)
                context = await browser.new_context(viewport={"width": 1440, "height": 1000})
                await context.add_init_script("localStorage.setItem('presentStudio.session', " + json.dumps(json.dumps(auth["user"])) + ");localStorage.setItem('presentStudio.accessToken', " + json.dumps(auth["accessToken"]) + ");")
                fabric_path = Path(os.environ["PERF_FABRIC_PATH"])

                async def dependencies(route):
                    if "fabric@5.3.0" in route.request.url:
                        await route.fulfill(path=str(fabric_path), content_type="application/javascript")
                    else:
                        await route.abort()

                await context.route("https://cdn.jsdelivr.net/**", dependencies)
                await context.route("https://fonts.**", lambda route: route.abort())
                page = await context.new_page()
                errors = []
                page.on("pageerror", lambda error: errors.append(error.stack or str(error)))
                meetings_finished = False

                async def slow_meetings(route):
                    nonlocal meetings_finished
                    await asyncio.sleep(2.5)
                    await route.continue_()
                    meetings_finished = True

                await page.route("**/api/meetings", slow_meetings)
                await page.goto(base + "/dashboard.html", wait_until="domcontentloaded")
                await page.locator("[data-open]").first.wait_for(timeout=2000)
                assert not meetings_finished, "Meeting request blocked presentation cards"
                assert "3 slides" in await page.locator(".presentation-card-copy p").first.inner_text()
                library_finished = False

                async def slow_library(route):
                    nonlocal library_finished
                    await asyncio.sleep(2.5)
                    await route.continue_()
                    library_finished = True

                async def slow_image(route):
                    await asyncio.sleep(0.8)
                    await route.fulfill(body=png, content_type="image/png")

                await page.route("**/api/media", slow_library)
                await page.route("**/slow-image.png", slow_image)
                await page.goto(base + f"/builder.html?id={deck['id']}", wait_until="domcontentloaded")
                await page.wait_for_function("typeof presentation !== 'undefined' && !loading && document.querySelectorAll('#slideList .slide-item').length === 3", timeout=2000)
                assert not library_finished, "Media library blocked editor startup"
                await page.evaluate("window.stablePreview=document.querySelectorAll('#slideList .slide-item')[2]")
                await page.locator("#slideList .slide-item").nth(1).click()
                await page.locator("#slideList .slide-item").nth(2).click()
                try:
                    await page.wait_for_function("currentSlideIndex===2 && !loading", timeout=5000)
                except Exception:
                    print("Slide switch diagnostics", await page.evaluate("({index:currentSlideIndex,loading,version:slideLoadVersion, count:canvas.getObjects().length})"), errors)
                    raise
                assert await page.evaluate("window.stablePreview===document.querySelectorAll('#slideList .slide-item')[2]"), "Unchanged preview DOM was rebuilt"
                await asyncio.sleep(1)
                assert await page.evaluate("canvas.getObjects().some(o=>o.text==='Third slide')"), "Late callback replaced the selected slide"

                async def delayed_save(route):
                    response = await route.fetch()
                    await asyncio.sleep(0.8)
                    await route.fulfill(response=response)

                await page.route("**/api/presentations/" + deck["id"], delayed_save)
                await page.evaluate("canvas.getObjects().find(o=>o.id==='title').set('text','First edit');schedule();void save().catch(()=>{})")
                await asyncio.sleep(0.1)
                await page.evaluate("canvas.getObjects().find(o=>o.id==='title').set('text','Newer edit');schedule()")
                try:
                    await page.wait_for_function("document.querySelector('#modeLabel').textContent==='Saved' && !savePromise", timeout=6000)
                except Exception:
                    print("Save diagnostics", await page.evaluate("({revision:editRevision,mode:document.querySelector('#modeLabel').textContent,text:canvas.getObjects().map(o=>o.text)})"), errors)
                    raise
                current = (await (await api.get(f"/api/presentations/{deck['id']}", headers=headers)).json())["presentation"]
                assert current["slides"][2]["canvas"]["fabric"]["objects"][0]["text"] == "Newer edit", ("Slow save lost newer changes", current["slides"][2]["canvas"], await page.evaluate("({revision:editRevision,mode:document.querySelector('#modeLabel').textContent,text:canvas.getObjects().map(o=>o.text)})"))
                await page.unroute("**/api/presentations/" + deck["id"])
                uploads = []

                async def pasted_upload(route):
                    uploads.append(route.request.post_data_buffer)
                    await asyncio.sleep(0.4)
                    await route.fulfill(json={"asset": {"id": "asset_browser", "name": "Pasted image.png", "mimeType": "image/png", "url": base + "/pasted-image.png", "size": len(png)}})

                await page.route("**/api/media/upload", pasted_upload)
                await page.route("**/pasted-image.png", lambda route: route.fulfill(body=png, content_type="image/png"))
                await page.evaluate("""encoded => {
                  const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
                  const data=new DataTransfer();data.items.add(new File([bytes],'clip.png',{type:'image/png'}));
                  document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true}));
                }""", base64.b64encode(png).decode())
                await page.locator("#slideList .slide-item").nth(0).click()
                await page.wait_for_function("presentation.slides[2].canvas.fabric.objects.some(o=>o.src?.includes('pasted-image.png'))", timeout=4000)
                assert len(uploads) == 1, "Clipboard image bypassed object-storage upload"
                assert not await page.evaluate("canvas.getObjects().some(o=>o.src?.includes('pasted-image.png'))"), "Upload was inserted into the wrong slide"
                await page.wait_for_function("!savePromise && document.querySelector('#modeLabel').textContent==='Saved'", timeout=6000)
                other = await context.new_page()
                other.on("pageerror", lambda error: errors.append(str(error)))
                await other.goto(base + f"/builder.html?id={deck['id']}", wait_until="domcontentloaded")
                await other.wait_for_function("typeof presentation !== 'undefined' && !loading", timeout=6000)
                await page.evaluate("presentation.title='Winning editor';schedule();save()")
                await other.evaluate("canvas.getObjects().find(o=>o.id==='title').set('text','Keep my local work');schedule();void save().catch(()=>{})")
                await other.locator("#saveConflict").wait_for(timeout=6000)
                assert await other.evaluate("saveConflict && canvas.getObjects().some(o=>o.text==='Keep my local work')")
                assert "Save conflict" in await other.locator("#modeLabel").inner_text()
                async with other.expect_download() as download_info:
                    await other.get_by_role("button", name="Download unsaved copy").click()
                download = await download_info.value
                exported = json.loads(Path(await download.path()).read_text(encoding="utf-8"))
                assert exported["slides"][0]["canvas"]["fabric"]["objects"][0]["text"] == "Keep my local work"
                current = (await (await api.get(f"/api/presentations/{deck['id']}", headers=headers)).json())["presentation"]
                assert current["title"] == "Winning editor"
                await other.close()
                # Exercise the ribbon fixes with the real Fabric library and API
                # in this isolated database, including persistence after reload.
                ribbon_deck = (await (await api.post('/api/presentations', headers=headers, data={'title': 'Ribbon regression'})).json())['presentation']
                await page.goto(base + f"/builder.html?id={ribbon_deck['id']}", wait_until='domcontentloaded')
                await page.wait_for_function("typeof presentation !== 'undefined' && !loading")
                await page.locator('[data-builder-tab="insert"]').click()
                await page.locator('[data-builder-action="new-slide"]').click()
                await page.wait_for_function("presentation.slides.length===2 && !loading && !savePromise && document.querySelector('#modeLabel').textContent==='Saved'")
                async def late_builder_ui(route):
                    response = await route.fetch()
                    await asyncio.sleep(0.5)
                    await route.fulfill(response=response)
                await page.route('**/js/builder-ui.js*', late_builder_ui)
                await page.reload(wait_until='domcontentloaded')
                await page.wait_for_function("typeof presentation !== 'undefined' && !loading && presentation.slides.length===2")
                await page.get_by_role('button', name='Duplicate slide 1', exact=True).click()
                await page.unroute('**/js/builder-ui.js*')
                await page.wait_for_function("presentation.slides.length===3 && !loading && !savePromise && document.querySelector('#modeLabel').textContent==='Saved'")
                await page.get_by_role('button', name='Delete slide 2', exact=True).click()
                await page.wait_for_function("presentation.slides.length===2 && !loading && !savePromise && document.querySelector('#modeLabel').textContent==='Saved'")
                await page.reload(wait_until='domcontentloaded')
                await page.wait_for_function("typeof presentation !== 'undefined' && !loading && presentation.slides.length===2")
                await page.locator('[data-builder-tab="insert"]').click()
                await page.locator('#insertText').click()
                authored = await page.evaluate("({left:active().left,top:active().top,opacity:active().opacity,scaleX:active().scaleX,scaleY:active().scaleY,id:active().id})")
                await page.locator('[data-builder-tab="animations"]').click()
                await page.locator('#animationDuration').fill('2000')
                await page.locator('#animationDelay').fill('3000')
                await page.locator('[data-animation="fly"]').click()
                await page.locator('[data-builder-action="preview-animation"]').click()
                await page.wait_for_function("document.querySelectorAll('.canvas-container > canvas').length >= 4")
                await page.wait_for_function("!savePromise && document.querySelector('#modeLabel').textContent==='Saved'")
                stored = (await (await api.get(f"/api/presentations/{ribbon_deck['id']}", headers=headers)).json())['presentation']
                stored_object = next(obj for obj in stored['slides'][0]['canvas']['fabric']['objects'] if obj.get('id') == authored['id'])
                for key in ['left', 'top', 'opacity', 'scaleX', 'scaleY']:
                    assert stored_object[key] == authored[key], ('Preview corrupted saved geometry', key)
                assert stored_object['animationDuration'] == 2000
                assert stored_object['animationDelay'] == 3000
                # Timing edits must save on their own, without another preset click.
                await page.locator('#animationDuration').fill('1500')
                await page.locator('#animationDelay').fill('0')
                await page.wait_for_function("!savePromise && document.querySelector('#modeLabel').textContent==='Saved'")
                await page.reload(wait_until='domcontentloaded')
                await page.wait_for_function("typeof presentation !== 'undefined' && !loading")
                restored = await page.evaluate("canvas.getObjects().find(o=>o.animation==='fly').toObject(['animationDuration','animationDelay'])")
                assert restored['animationDuration'] == 1500 and restored['animationDelay'] == 0
                for key in ['left', 'top', 'opacity', 'scaleX', 'scaleY']:
                    assert restored[key] == authored[key]
                await page.set_viewport_size({'width': 1440, 'height': 900})
                layout = await page.evaluate("({stage:document.querySelector('#canvasStage').getBoundingClientRect().width,workspace:document.querySelector('#workspace').clientWidth,padding:parseFloat(getComputedStyle(document.querySelector('#workspace')).paddingLeft)})")
                assert layout['padding'] <= 8 and layout['stage'] >= layout['workspace'] - 18, layout
                await page.locator('[data-builder-tab="insert"]').click()
                assert await page.locator('#insertSlideBackground').is_enabled()
                assert not await page.locator('.shape-format-group').is_visible()
                assert not await page.locator('.wordart-format-group').is_visible()
                await page.locator('#insertSlideBackground').evaluate("input=>{input.value='#234567';input.dispatchEvent(new Event('input',{bubbles:true}))}")
                await page.wait_for_function("!savePromise && document.querySelector('#modeLabel').textContent==='Saved'")
                await page.reload(wait_until='domcontentloaded')
                await page.wait_for_function("typeof presentation !== 'undefined' && !loading")
                assert await page.evaluate("canvas.backgroundColor") == '#234567'
                assert await page.locator('#slideBackground').input_value() == '#234567'
                await page.locator('[data-builder-tab="insert"]').click()
                assert await page.locator('#insertSlideBackground').input_value() == '#234567'
                await page.locator('[data-shape="rectangle"]').click()
                assert await page.locator('#shapeFill').is_enabled()
                await page.locator('#shapeFill').evaluate("input=>{input.value='#22aa66';input.dispatchEvent(new Event('input',{bubbles:true}))}")
                assert await page.evaluate("active().getObjects().some(o=>o.fill==='#22aa66')")
                await page.locator('[data-builder-tab="home"]').click()
                await page.evaluate("const shape=active();canvas.discardActiveObject();canvas.setActiveObject(shape)")
                assert 'is-active' in await page.locator('[data-builder-tab="insert"]').get_attribute('class')
                await page.evaluate("encoded=>image({id:'selection-photo',src:'data:image/png;base64,'+encoded,fitToSlide:true})", base64.b64encode(png).decode())
                await page.wait_for_function("pendingInsertions===0 && active()?.mediaType==='image'")
                await page.locator('[data-builder-tab="home"]').click()
                await page.evaluate("const photo=canvas.getObjects().find(o=>o.id==='selection-photo');canvas.discardActiveObject();canvas.setActiveObject(photo)")
                assert 'is-active' in await page.locator('[data-builder-tab="insert"]').get_attribute('class')
                assert await page.locator('.fit-media-tool').is_visible()
                assert not await page.locator('.wordart-format-group').is_visible()
                assert not await page.locator('.shape-format-group').is_visible()
                await page.locator('.fit-media-tool').click()
                await page.wait_for_function("!savePromise && document.querySelector('#modeLabel').textContent==='Saved'")
                await page.screenshot(path=os.environ.get("PERF_SCREENSHOT", str(Path(directory) / "builder.png")))
                assert not errors, errors
                print("Browser checks passed: independent loading, rapid slide switching, concurrent saves, conflict recovery, ribbon slide autosave, isolated animation preview, timing persistence, wider workspace, background persistence, shape fill and contextual Insert tools")
                await context.close()
                await browser.close()
                await api.dispose()
        finally:
            server.terminate()
            server.wait(timeout=10)


if __name__ == "__main__":
    asyncio.run(run())
