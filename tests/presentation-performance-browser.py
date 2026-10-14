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
                for _ in range(100):
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
                browser = await playwright.chromium.launch(headless=True)
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
                await page.screenshot(path=os.environ.get("PERF_SCREENSHOT", str(Path(directory) / "builder.png")))
                assert not errors, errors
                print("Browser checks passed: independent dashboard/editor loading, sidebar reuse, rapid slide switching, and slow-save edit preservation")
                await context.close()
                await browser.close()
                await api.dispose()
        finally:
            server.terminate()
            server.wait(timeout=10)


if __name__ == "__main__":
    asyncio.run(run())
