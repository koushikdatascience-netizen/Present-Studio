"""Isolated CI application with in-memory S3; never uses an AWS account."""
from io import BytesIO
import os
import re

from fastapi.responses import HTMLResponse, FileResponse
from app.config import get_settings

from app.main import fastapi_app, app
from app.routers import media
from app.services import presentation_images


class Body(BytesIO):
    def iter_chunks(self, chunk_size=65536):
        while chunk := self.read(chunk_size):
            yield chunk


class Storage:
    bucket = "isolated-test-bucket"
    presigned_expiry = 900

    def __init__(self):
        self.objects = {}
        self.client = self

    def media_key(self, owner, asset):
        return f"media/{owner}/{asset}"

    def upload_bytes(self, *, content, key, content_type):
        self.objects[key] = (content, content_type)

    def get_object(self, *, Bucket, Key):
        content, mime = self.objects[Key]
        return {"Body": Body(content), "ContentLength": len(content), "ContentType": mime}

    def presigned_get(self, key):
        raise AssertionError("Canvas images must not redirect to object storage")


storage = Storage()
media.s3_storage = lambda: storage
presentation_images.get_s3_storage = lambda: storage
# Poster creation is unrelated to canvas loading and would require ffmpeg.
media.create_media_poster = lambda *args: None


@fastapi_app.get("/__canvas_regression", include_in_schema=False)
def regression_page():
    return HTMLResponse("<html><body>Isolated image cache test</body></html>")


@fastapi_app.get("/__fabric.js", include_in_schema=False)
def local_fabric():
    return FileResponse(os.environ["PERF_FABRIC_PATH"], media_type="application/javascript")


@fastapi_app.middleware("http")
async def local_builder_dependencies(request, call_next):
    if request.url.path == "/builder.html":
        page = (get_settings().frontend_dir / "builder.html").read_text()
        page = page.replace("https://cdn.jsdelivr.net/npm/fabric@5.3.0/dist/fabric.min.js", "/__fabric.js")
        page = re.sub(r'<script src="https://[^"]+"></script>', "", page)
        page = re.sub(r'<link[^>]*href="https://[^"]+"[^>]*>', "", page)
        return HTMLResponse(page)
    return await call_next(request)
