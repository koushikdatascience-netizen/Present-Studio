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
@pytest.mark.parametrize("access_type", ["public", "private"])
def test_s3_upload_stable_url_and_meeting_preview(mime, kind, access_type):
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
            assert storage.upload_bytes.call_count == 2
            content = client.get(asset["url"], follow_redirects=False)
            assert content.status_code == 307
            assert "signature=test" in content.headers["location"]
            body = MagicMock()
            body.iter_chunks.return_value = iter([b"preview-image"])
            storage.client.get_object.return_value = {"Body": body, "ContentLength": 13, "ContentType": "image/jpeg"}
            preview = client.get(f"/api/media/{asset['id']}/preview", follow_redirects=False)
            assert preview.status_code == 200
            assert preview.content == b"preview-image"
            assert "location" not in preview.headers
            body.close.assert_called_once()
            if kind == "video":
                thumbnail = client.get(f"/api/media/{asset['id']}/thumbnail", follow_redirects=False)
                assert thumbnail.status_code == 307

        meeting = client.post("/api/meetings", headers=headers, json={"title": 'Team <Launch> & Review', "accessType": access_type}).json()
        with SessionLocal() as db:
            slide = db.query(Slide).filter(Slide.presentation_id == meeting["presentationId"]).first()
            slide.canvas = {"elements": [{"id": "meeting_media_test", "type": kind, "src": asset["url"], "full_bleed": True}]}
            db.commit()
        page = client.get(meeting["audienceUrl"]).text
        assert 'property="og:title" content="Team &lt;Launch&gt; &amp; Review | SnapKey Studio"' in page
        expected = asset["url"].replace("/content", "/preview")
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


@pytest.mark.parametrize("access_type", ["public", "private"])
def test_youtube_meeting_preview_and_media_link_revision(access_type):
    with TestClient(fastapi_app) as client:
        signup = client.post("/api/auth/signup", json={"name": "YouTube Owner", "email": f"youtube-{uuid4().hex}@example.com", "password": "securepass123"})
        headers = {"Authorization": f"Bearer {signup.json()['accessToken']}"}
        meeting = client.post("/api/meetings", headers=headers, json={"title": "Video meeting", "accessType": access_type, "timingMode": "instant", "durationMode": "unlimited"}).json()
        with SessionLocal() as db:
            slide = db.query(Slide).filter(Slide.presentation_id == meeting["presentationId"]).first()
            slide.canvas = {"elements": [{"id": "meeting_media_test", "type": "youtube", "youtubeId": "dQw4w9WgXcQ", "src": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"}]}
            db.commit()
        updated = next(item for item in client.get("/api/meetings", headers=headers).json()["meetings"] if item["id"] == meeting["id"])
        assert "?preview=" in updated["audienceUrl"]
        assert updated["audienceUrl"] != meeting["audienceUrl"]
        page = client.get(updated["audienceUrl"]).text
        assert 'property="og:image" content="https://testserver/api/media/youtube/dQw4w9WgXcQ/preview"' in page
        assert f'property="og:url" content="{updated["audienceUrl"]}"' in page
        if access_type == "private":
            assert len(meeting["accessCode"]) == 4
            assert meeting["accessCode"].isdigit()
            access = client.post(f"/api/presentations/{meeting['presentationId']}/screen-access", json={"token": meeting["audienceUrl"].rsplit("/", 1)[-1], "screenAccessCode": meeting["accessCode"]})
            assert access.status_code == 200


def test_youtube_thumbnail_is_served_directly():
    response = MagicMock(status_code=200, content=b"thumbnail", headers={"content-type": "image/jpeg"})
    with TestClient(fastapi_app) as client, patch("app.routers.media.httpx.get", return_value=response) as fetch:
        preview = client.get("/api/media/youtube/dQw4w9WgXcQ/preview", follow_redirects=False)
        assert preview.status_code == 200
        assert preview.content == b"thumbnail"
        assert preview.headers["content-type"] == "image/jpeg"
        assert "location" not in preview.headers
        fetch.assert_called_once_with("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg", timeout=10)
