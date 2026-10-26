import base64
from copy import deepcopy
from io import BytesIO
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from fastapi.testclient import TestClient
from PIL import Image
import pytest

from app.config import get_settings
from app.database import SessionLocal
from app.main import fastapi_app
from app.models import LiveSession, MediaAsset, Slide, User
from app.services.presentation_images import image_preview, lightweight_cover
from app.migrate_slide_images import migrate


def raster():
    buffer = BytesIO()
    Image.new("RGB", (1024, 768), "red").save(buffer, format="PNG")
    content = buffer.getvalue()
    return content, "data:image/png;base64," + base64.b64encode(content).decode()


def owner_and_deck(client):
    auth = client.post("/api/auth/signup", json={"name": "Performance Owner", "email": uuid4().hex + "@example.com", "password": "securepass123"}).json()
    headers = {"Authorization": "Bearer " + auth["accessToken"]}
    deck = client.post("/api/presentations", headers=headers, json={"title": "Performance deck"}).json()["presentation"]
    return auth, headers, deck


def scene(src):
    return {"background": "#fff", "notes": "Keep my notes", "fabric": {"version": "5.3.0", "objects": [
        {"id": "photo", "type": "image", "mediaType": "image", "src": src, "left": 64, "top": 32, "width": 1024, "height": 768, "scaleX": 0.5, "scaleY": 0.5},
        {"id": "caption", "type": "textbox", "text": "Keep this text", "fontSize": 24}
    ]}}


def mock_storage():
    storage = MagicMock()
    storage.media_key.side_effect = lambda owner, asset: f"media/{owner}/{asset}"
    storage.presigned_expiry = 900
    storage.presigned_get.return_value = "https://storage.example/image?signature=test"
    return storage


def test_summary_is_paginated_owner_scoped_and_omits_embedded_images():
    _, inline = raster()
    with TestClient(fastapi_app) as client:
        _, headers, deck = owner_and_deck(client)
        _, other_headers, _ = owner_and_deck(client)
        with SessionLocal() as db:
            first = db.get(Slide, deck["slides"][0]["id"])
            first.canvas = scene(inline)
            db.add(Slide(id="slide_" + uuid4().hex, presentation_id=deck["id"], order=2, title="Second", canvas=scene(inline)))
            db.commit()
        summaries = client.get("/api/presentations?summary=true&limit=1", headers=headers)
        assert summaries.status_code == 200
        body = summaries.json()
        assert body["total"] == 1 and body["slideTotal"] == 2
        assert body["presentations"][0]["slideCount"] == 2
        assert len(body["presentations"][0]["slides"]) == 1
        assert len(summaries.content) < 6000 and inline not in summaries.text
        assert client.get("/api/presentations?summary=true&offset=1", headers=headers).json()["presentations"] == []
        assert deck["id"] not in client.get("/api/presentations?summary=true", headers=other_headers).text
        # The existing full-deck endpoint and actual saved data remain intact.
        full = client.get(f"/api/presentations/{deck['id']}", headers=headers).json()["presentation"]
        assert full["slides"][0]["canvas"]["fabric"]["objects"][0]["src"] == inline
        assert len(client.get("/api/presentations", headers=headers).json()["presentations"][0]["slides"]) == 2


def test_save_externalizes_and_deduplicates_images_preserving_scene_and_event_contract():
    content, inline = raster()
    storage = mock_storage()
    with TestClient(fastapi_app) as client:
        auth, headers, deck = owner_and_deck(client)
        first_id = deck["slides"][0]["id"]
        original = scene(inline)
        deck["slides"][0]["canvas"] = original
        deck["slides"].append({"id": "slide_" + uuid4().hex, "order": 2, "title": "Duplicate image", "canvas": deepcopy(original)})
        with patch.object(get_settings(), "storage_provider", "s3"), patch("app.services.presentation_images.get_s3_storage", return_value=storage), patch("app.routers.presentations.sio.emit", new_callable=AsyncMock) as emit:
            result = client.put(f"/api/presentations/{deck['id']}", headers=headers, json=deck)
            assert result.status_code == 200
            saved = result.json()["presentation"]
            image = saved["slides"][0]["canvas"]["fabric"]["objects"][0]
            assert image["src"].startswith("/api/media/") and image["thumbnailSrc"].endswith("/image-preview")
            assert image["left"] == 64 and image["scaleX"] == 0.5
            assert saved["slides"][0]["canvas"]["notes"] == original["notes"]
            assert saved["slides"][0]["id"] == first_id
            assert saved["slides"][1]["canvas"]["fabric"]["objects"][0]["src"] == image["src"]
            assert storage.upload_bytes.call_count == 2  # original plus small WebP, not each occurrence
            assert storage.upload_bytes.call_args_list[0].kwargs["content"] == content
            assert emit.await_args.args[0] == "presentation_updated"
            assert "presentation" not in emit.await_args.args[1]
            assert emit.await_args.args[1]["changes"]["slides"] == saved["slides"]
            client.put(f"/api/presentations/{deck['id']}", headers=headers, json=saved).raise_for_status()
            assert storage.upload_bytes.call_count == 2
        with SessionLocal() as db:
            assert db.query(MediaAsset).filter(MediaAsset.owner_id == auth["user"]["id"]).count() == 1


def test_storage_failure_never_replaces_original_slide():
    _, inline = raster()
    storage = mock_storage()
    storage.upload_bytes.side_effect = RuntimeError("Object storage unavailable")
    with TestClient(fastapi_app, raise_server_exceptions=False) as client:
        _, headers, deck = owner_and_deck(client)
        before = deepcopy(deck)
        deck["slides"][0]["canvas"] = scene(inline)
        with patch.object(get_settings(), "storage_provider", "s3"), patch("app.services.presentation_images.get_s3_storage", return_value=storage):
            assert client.put(f"/api/presentations/{deck['id']}", headers=headers, json=deck).status_code == 500
        current = client.get(f"/api/presentations/{deck['id']}", headers=headers).json()["presentation"]
        assert current["slides"] == before["slides"]


def test_image_quota_is_enforced_before_storage_upload():
    _, inline = raster()
    storage = mock_storage()
    with TestClient(fastapi_app) as client:
        auth, headers, deck = owner_and_deck(client)
        with SessionLocal() as db:
            db.get(User, auth["user"]["id"]).storage_limit_bytes = 1
            db.commit()
        deck["slides"][0]["canvas"] = scene(inline)
        with patch.object(get_settings(), "storage_provider", "s3"), patch("app.services.presentation_images.get_s3_storage", return_value=storage):
            assert client.put(f"/api/presentations/{deck['id']}", headers=headers, json=deck).status_code == 413
        storage.upload_bytes.assert_not_called()


def test_small_preview_and_cover_leave_original_unchanged():
    content, inline = raster()
    source = scene(inline)
    cover = lightweight_cover(source)
    assert source["fabric"]["objects"][0]["src"] == inline
    assert cover["fabric"]["objects"][0]["src"] == ""
    assert "notes" not in cover
    with Image.open(BytesIO(image_preview(content))) as preview:
        assert preview.width <= 320 and preview.height <= 180


def test_uploaded_images_expose_small_previews_and_bounded_private_cache():
    content, _ = raster()
    storage = mock_storage()
    storage.presigned_expiry = 120

    def poster(arguments, **kwargs):
        from pathlib import Path
        Path(arguments[-1]).write_bytes(b"poster")

    with TestClient(fastapi_app) as client:
        _, headers, _ = owner_and_deck(client)
        with patch.object(get_settings(), "storage_provider", "s3"), patch("app.routers.media.s3_storage", return_value=storage), patch("app.routers.media.subprocess.run", side_effect=poster):
            uploaded = client.post("/api/media/upload", headers=headers, files={"file": ("photo.png", content, "image/png")})
            assert uploaded.status_code == 200
            asset = uploaded.json()["asset"]
            assert asset["thumbnailUrl"] == f"/api/media/{asset['id']}/image-preview"
            assert any(call.kwargs["key"].endswith(".preview.webp") for call in storage.upload_bytes.call_args_list)
            for url in (asset["url"], asset["thumbnailUrl"]):
                response = client.get(url, follow_redirects=False)
                assert response.status_code == 307
                assert response.headers["cache-control"] == "private, max-age=60"


def test_migration_dry_run_backup_and_live_deck_protection(tmp_path):
    _, inline = raster()
    storage = mock_storage()
    with TestClient(fastapi_app) as client:
        _, _, deck = owner_and_deck(client)
        slide_id = deck["slides"][0]["id"]
        with SessionLocal() as db:
            db.get(Slide, slide_id).canvas = scene(inline)
            db.commit()
        assert migrate(presentation_id=deck["id"])["embeddedImages"] == 1
        with SessionLocal() as db:
            assert db.get(Slide, slide_id).canvas["fabric"]["objects"][0]["src"] == inline
            db.query(LiveSession).filter(LiveSession.presentation_id == deck["id"]).one().is_live = True
            db.commit()
        backup = tmp_path / "recovery.json"
        with patch.object(get_settings(), "storage_provider", "s3"), patch("app.services.presentation_images.get_s3_storage", return_value=storage):
            assert migrate(apply=True, backup=backup, presentation_id=deck["id"])["migratedDecks"] == 0
            storage.upload_bytes.assert_not_called()
            with SessionLocal() as db:
                db.query(LiveSession).filter(LiveSession.presentation_id == deck["id"]).one().is_live = False
                db.commit()
            backup = tmp_path / "idle-recovery.json"
            assert migrate(apply=True, backup=backup, presentation_id=deck["id"])["migratedDecks"] == 1
            assert inline in backup.read_text()
            with pytest.raises(FileExistsError):
                migrate(apply=True, backup=backup, presentation_id=deck["id"])


def test_stale_and_unversioned_saves_cannot_overwrite_or_upload():
    with TestClient(fastapi_app) as client:
        _, headers, deck = owner_and_deck(client)
        stale = deepcopy(deck)
        deck["title"] = "First editor"
        with patch("app.routers.presentations.sio.emit", new_callable=AsyncMock) as emit:
            saved = client.put(f"/api/presentations/{deck['id']}", headers=headers, json=deck)
            assert saved.status_code == 200
            assert saved.json()["presentation"]["updatedAt"] != stale["updatedAt"]
            with patch("app.services.presentation_persistence.externalize_images") as images:
                stale["title"] = "Stale editor"
                assert client.put(f"/api/presentations/{deck['id']}", headers=headers, json=stale).status_code == 409
                stale.pop("updatedAt")
                assert client.put(f"/api/presentations/{deck['id']}", headers=headers, json=stale).status_code == 428
                images.assert_not_called()
            assert emit.await_count == 1
        current = client.get(f"/api/presentations/{deck['id']}", headers=headers).json()["presentation"]
        assert current["title"] == "First editor"


def test_simultaneous_saves_have_only_one_winner():
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    from app.schemas import PresentationSave
    from app.services.presentation_persistence import persist_presentation
    from fastapi import HTTPException
    with TestClient(fastapi_app) as client:
        auth, _, deck = owner_and_deck(client)
        barrier = Barrier(2)
        def save(title):
            payload = PresentationSave(**{**deck, "title": title})
            barrier.wait(timeout=5)
            try:
                persist_presentation(deck["id"], payload, auth["user"]["id"])
                return 200
            except HTTPException as error:
                return error.status_code
        with ThreadPoolExecutor(max_workers=2) as pool:
            assert sorted(pool.map(save, ["Editor A", "Editor B"])) == [200, 409]


def test_delta_omits_unchanged_canvases_and_preserves_order_and_deletions():
    with TestClient(fastapi_app) as client:
        _, headers, deck = owner_and_deck(client)
        first = deck["slides"][0]
        first["canvas"]["notes"] = "large unchanged scene " * 10000
        deck["slides"] = [first, {**deepcopy(first), "id": "slide_" + uuid4().hex, "order": 2},
                          {**deepcopy(first), "id": "slide_" + uuid4().hex, "order": 3}]
        saved = client.put(f"/api/presentations/{deck['id']}", headers=headers, json=deck).json()["presentation"]
        base = saved["updatedAt"]
        # Remove the middle slide, keep explicit positions, edit only the last.
        saved["slides"].pop(1)
        saved["slides"][-1]["title"] = "Edited"
        with patch("app.routers.presentations.sio.emit", new_callable=AsyncMock) as emit:
            response = client.put(f"/api/presentations/{deck['id']}", headers=headers, json=saved)
        assert response.status_code == 200
        event = emit.await_args.args[1]
        assert event["baseUpdatedAt"] == base
        assert "presentation" not in event
        assert event["changes"]["slideOrder"] == [s["id"] for s in saved["slides"]]
        assert [s["id"] for s in event["changes"]["slides"]] == [saved["slides"][-1]["id"]]
