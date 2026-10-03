from pathlib import Path
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.database import SessionLocal
from app.main import fastapi_app
from app.models import Slide


@pytest.mark.parametrize("mime,kind", [("image/png", "image"), ("video/mp4", "video")])
def test_s3_upload_stable_url_and_meeting_preview(mime, kind):
    storage = MagicMock()
    storage.media_key.side_effect = lambda owner, asset: f"media/{owner}/{asset}"
    storage.presigned_get.return_value = "https://bucket.example/media?signature=test"

    def generate_poster(arguments, **kwargs):
        Path(arguments[-1]).write_bytes(b"jpeg-poster")

    with TestClient(fastapi_app) as client:
        signup = client.post("/api/auth/signup", json={"name": "Media Owner", "email": f"media-{uuid4().hex}@example.com", "password": "securepass123"})
        headers = {"Authorization": f"Bearer {signup.json()['accessToken']}"}
        with patch.object(get_settings(), "storage_provider", "s3"), patch("app.routers.media.s3_storage", return_value=storage), patch("app.routers.media.subprocess.run", side_effect=generate_poster), patch("app.routers.media.cloudinary.uploader.upload") as cloud_upload:
            upload = client.post("/api/media/upload", headers=headers, files={"file": ("room", b"sample-media", mime)})
            assert upload.status_code == 200
            asset = upload.json()["asset"]
            assert asset["url"] == f"/api/media/{asset['id']}/content"
            cloud_upload.assert_not_called()
            assert storage.upload_bytes.call_count == (2 if kind == "video" else 1)
            content = client.get(asset["url"], follow_redirects=False)
            assert content.status_code == 307
            assert "signature=test" in content.headers["location"]
            if kind == "video":
                thumbnail = client.get(f"/api/media/{asset['id']}/thumbnail", follow_redirects=False)
                assert thumbnail.status_code == 307

        meeting = client.post("/api/meetings", headers=headers, json={"title": 'Team <Launch> & Review', "accessType": "public"}).json()
        with SessionLocal() as db:
            slide = db.query(Slide).filter(Slide.presentation_id == meeting["presentationId"]).first()
            slide.canvas = {"elements": [{"type": kind, "src": asset["url"], "full_bleed": True}]}
            db.commit()
        page = client.get(meeting["audienceUrl"]).text
        assert 'property="og:title" content="Team &lt;Launch&gt; &amp; Review | SnapKey Studio"' in page
        expected = asset["url"].replace("/content", "/thumbnail") if kind == "video" else asset["url"]
        assert f'property="og:image" content="https://testserver{expected}"' in page


def test_s3_failure_returns_clear_upload_error():
    storage = MagicMock()
    storage.upload_bytes.side_effect = RuntimeError("storage failure")
    with TestClient(fastapi_app) as client:
        signup = client.post("/api/auth/signup", json={"name": "Upload Owner", "email": f"upload-{uuid4().hex}@example.com", "password": "securepass123"})
        headers = {"Authorization": f"Bearer {signup.json()['accessToken']}"}
        with patch.object(get_settings(), "storage_provider", "s3"), patch("app.routers.media.s3_storage", return_value=storage):
            response = client.post("/api/media/upload", headers=headers, files={"file": ("room.png", b"image", "image/png")})
        assert response.status_code == 502
        assert response.json()["detail"] == "Object storage upload failed. Please try again."
