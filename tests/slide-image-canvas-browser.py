"""Exercise thumbnail cache -> real Fabric editor -> save -> reopen, using fake S3."""
import asyncio
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
    with tempfile.TemporaryDirectory(prefix="s3-canvas-ci-") as directory:
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        base = f"http://127.0.0.1:{port}"
        env = {**os.environ, "DATABASE_URL": "sqlite:///" + str(Path(directory) / "test.db"),
               "PUBLIC_BASE_URL": base, "STORAGE_PROVIDER": "s3", "JWT_SECRET": "isolated-canvas-test",
               "PYTHONPATH": os.pathsep.join([str(ROOT / "backend"), str(ROOT / "tests")]),
               "LIVEKIT_URL": "", "LIVEKIT_API_KEY": "", "LIVEKIT_API_SECRET": ""}
        with (Path(directory) / "server.log").open("w+") as log:
            server = subprocess.Popen([os.sys.executable, "-m", "uvicorn", "s3_canvas_test_app:app",
                                       "--host", "127.0.0.1", "--port", str(port)],
                                      cwd=ROOT, env=env, stdout=log, stderr=log)
            try:
                async with async_playwright() as pw:
                    api = await pw.request.new_context(base_url=base)
                    for _ in range(150):
                        try:
                            if (await api.get("/api/health")).ok:
                                break
                        except Exception:
                            pass
                        await asyncio.sleep(0.1)
                    else:
                        raise RuntimeError("Isolated image test server failed to start")
                    signup = await api.post("/api/auth/signup", data={
                        "name": "Canvas Owner", "email": uuid4().hex + "@example.com", "password": "securepass123"})
                    assert signup.ok, await signup.text()
                    auth = await signup.json()
                    headers = {"Authorization": "Bearer " + auth["accessToken"]}
                    buffer = BytesIO()
                    Image.new("RGB", (800, 450), "gold").save(buffer, format="PNG")
                    uploaded = await api.post("/api/media/upload", headers=headers, multipart={
                        "file": {"name": "canvas.png", "mimeType": "image/png", "buffer": buffer.getvalue()}})
                    assert uploaded.ok, await uploaded.text()
                    asset = (await uploaded.json())["asset"]
                    created = await api.post("/api/presentations", headers=headers, data={"title": "S3 canvas regression"})
                    deck = (await created.json())["presentation"]
                    deck["slides"][0]["canvas"] = {"background": "#fff", "fabric": {"version": "5.3.0", "objects": [{
                        "id": "saved-image", "type": "image", "mediaType": "image", "src": asset["url"],
                        "crossOrigin": "anonymous", "width": 800, "height": 450,
                        "left": 40, "top": 40, "scaleX": 1, "scaleY": 1}]}}
                    saved = await api.put(f"/api/presentations/{deck['id']}", headers=headers, data=deck)
                    assert saved.ok, await saved.text()
                    browser = await pw.chromium.launch(headless=True)
                    context = await browser.new_context(viewport={"width": 1440, "height": 1000})
                    await context.add_init_script(
                        "localStorage.setItem('presentStudio.session'," + json.dumps(json.dumps(auth["user"])) +
                        ");localStorage.setItem('presentStudio.accessToken'," + json.dumps(auth["accessToken"]) + ");")

                    page = await context.new_page()
                    errors, image_statuses = [], []
                    page.on("pageerror", lambda error: errors.append(str(error)))
                    page.on("response", lambda response: image_statuses.append(response.status)
                            if response.url == base + asset["url"] else None)
                    await page.goto(base + "/__canvas_regression")
                    # Prime Chromium's real HTTP cache without request interception.
                    await page.evaluate("""src => new Promise((resolve, reject) => {
                      const image = new Image(); image.onload = resolve; image.onerror = reject;
                      document.body.append(image); image.src = src;
                    })""", asset["url"])
                    await page.goto(base + f"/builder.html?id={deck['id']}", wait_until="domcontentloaded")
                    await page.wait_for_function(
                        "typeof canvas!=='undefined' && !loading && canvas.getObjects().some(o=>o.id==='saved-image' && o.width>0)",
                        timeout=15000)
                    assert await page.evaluate("!imageRestoreProblem")
                    assert await page.evaluate("canvas.toDataURL().startsWith('data:image/png')")
                    await page.evaluate("canvas.getObjects().find(o=>o.id==='saved-image').set('left',60);schedule();save()")
                    await page.wait_for_function("!savePromise && document.querySelector('#modeLabel').textContent==='Saved'", timeout=10000)
                    persisted = (await (await api.get(f"/api/presentations/{deck['id']}", headers=headers)).json())["presentation"]
                    obj = persisted["slides"][0]["canvas"]["fabric"]["objects"][0]
                    assert obj["id"] == "saved-image" and obj["src"].endswith(asset["url"]) and obj["left"] == 60
                    await page.reload(wait_until="domcontentloaded")
                    await page.wait_for_function(
                        "typeof canvas!=='undefined' && !loading && canvas.getObjects().some(o=>o.id==='saved-image' && o.left===60)",
                        timeout=15000)
                    assert await page.evaluate("!imageRestoreProblem")
                    assert image_statuses and set(image_statuses) == {200}, image_statuses
                    assert not errors, errors
                    await page.screenshot(path=os.environ.get("IMAGE_SCREENSHOT", str(Path(directory) / "image.png")))
                    await context.close()
                    await browser.close()
                    await api.dispose()
                    print("S3 canvas browser check passed: plain thumbnail, Fabric restore, untainted canvas, save and reopen")
            except Exception:
                log.flush()
                log.seek(0)
                print(log.read()[-8000:])
                raise
            finally:
                server.terminate()
                server.wait(timeout=10)


if __name__ == "__main__":
    asyncio.run(run())
