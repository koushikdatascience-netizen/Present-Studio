from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch
from uuid import uuid4
from datetime import datetime, timedelta, timezone
import asyncio
import jwt
from app import socket_manager
from app.database import SessionLocal
from app.config import get_settings
from app.main import fastapi_app, live_session_repair_statements, share_link_repair_statements
from app.live_state import meeting_control_payload
from app.models import LiveSession, Meeting, Presentation, ShareLink, User
from app.security import hash_password


def test_health():
    with TestClient(fastapi_app) as client:
        response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_login_and_list_presentations():
    with TestClient(fastapi_app) as client:
        login = client.post("/api/auth/login", json={"email": "owner@presentstudio.local", "password": "password123"})
        assert login.status_code == 200
        token = login.json()["accessToken"]

        response = client.get("/api/presentations", headers={"Authorization": f"Bearer {token}"})
    assert login.status_code == 200
    assert response.status_code == 200
    assert response.json()["presentations"]


def test_create_presentation_creates_its_live_session():
    email = f"presentation-owner-{uuid4().hex}@example.com"
    with TestClient(fastapi_app) as client:
        signup = client.post(
            "/api/auth/signup",
            json={"name": "Presentation Owner", "email": email, "password": "securepass123"},
        )
        token = signup.json()["accessToken"]
        response = client.post(
            "/api/presentations",
            json={"title": "Builder test presentation"},
            headers={"Authorization": f"Bearer {token}"},
        )
    assert signup.status_code == 200
    assert response.status_code == 200
    assert response.json()["presentation"]["title"] == "Builder test presentation"


def test_read_only_presentation_share_can_expire_and_be_revoked():
    email = f"viewer-share-{uuid4().hex}@example.com"
    with TestClient(fastapi_app) as client:
        signup = client.post("/api/auth/signup", json={"name": "Share Owner", "email": email, "password": "securepass123"})
        headers = {"Authorization": f"Bearer {signup.json()['accessToken']}"}
        created = client.post("/api/presentations", json={"title": "Quarterly review"}, headers=headers)
        presentation_id = created.json()["presentation"]["id"]
        assert client.get(f"/api/presentations/{presentation_id}/viewer-share", headers=headers).json() is None
        link = client.post(f"/api/presentations/{presentation_id}/viewer-share", json={"expiresInDays": 7}, headers=headers)
        assert link.status_code == 200
        data = link.json()
        token = data["token"]
        assert data["permission"] == "viewer"
        assert data["expiresAt"]
        assert data["url"].endswith(f"/presentation/{token}")

        viewer = client.get(f"/api/presentations/{presentation_id}?token={token}")
        landing = client.get(f"/presentation/{token}")
        assert viewer.status_code == 200 and viewer.json()["permission"] == "viewer"
        assert landing.status_code == 200
        assert "Quarterly review | SnapKey Studio" in landing.text
        assert 'id="viewerAutoplay"' in landing.text
        assert "meeting" not in landing.text.lower()

        replacement = client.post(f"/api/presentations/{presentation_id}/viewer-share", json={"expiresInDays": None}, headers=headers)
        assert replacement.status_code == 200
        assert replacement.json()["token"] != token
        assert client.get(f"/api/presentations/{presentation_id}?token={token}").status_code == 403
        assert client.delete(f"/api/presentations/{presentation_id}/viewer-share", headers=headers).json() == {"ok": True}
        assert client.get(f"/api/presentations/{presentation_id}?token={replacement.json()['token']}").status_code == 403

        expiring = client.post(f"/api/presentations/{presentation_id}/viewer-share", json={"expiresInDays": 7}, headers=headers).json()
        with SessionLocal() as db:
            share = db.query(ShareLink).filter_by(token=expiring["token"]).one()
            share.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
            db.commit()
        assert client.get(f"/api/presentations/{presentation_id}?token={expiring['token']}").status_code == 403
        assert client.get(f"/api/presentations/{presentation_id}/viewer-share", headers=headers).json() is None


def test_presentation_viewer_shares_cannot_be_created_for_meetings():
    email = f"meeting-share-{uuid4().hex}@example.com"
    with TestClient(fastapi_app) as client:
        signup = client.post("/api/auth/signup", json={"name": "Meeting Owner", "email": email, "password": "securepass123"})
        headers = {"Authorization": f"Bearer {signup.json()['accessToken']}"}
        meeting = client.post("/api/meetings", json={"title": "Planning", "timingMode": "instant", "durationMode": "unlimited", "accessType": "public"}, headers=headers)
        response = client.post(f"/api/presentations/{meeting.json()['presentationId']}/viewer-share", json={}, headers=headers)
    assert response.status_code == 409


def test_create_public_instant_meeting_returns_passwordless_audience_link():
    email = f"meeting-owner-{uuid4().hex}@example.com"
    with TestClient(fastapi_app) as client:
        signup = client.post("/api/auth/signup", json={"name": "Meeting Owner", "email": email, "password": "securepass123"})
        headers = {"Authorization": f"Bearer {signup.json()['accessToken']}"}
        response = client.post(
            "/api/meetings",
            json={"title": "Public team room", "timingMode": "instant", "durationMode": "unlimited", "accessType": "public"},
            headers=headers,
        )
        meetings = client.get("/api/meetings", headers=headers)
        access = client.get(f"/api/presentations/{response.json()['presentationId']}/screen-access?token={response.json()['audienceUrl'].rsplit('/', 1)[-1]}")
        settings = get_settings()
        client.cookies.clear()
        with patch.object(settings, "livekit_url", "wss://example.livekit.cloud"), patch.object(settings, "livekit_api_key", "key"), patch.object(settings, "livekit_api_secret", "secret"), patch("app.routers.presentations.create_livekit_join_token", return_value="signed-token"), patch("app.routers.presentations.meeting_admission_required", return_value=True), patch("app.routers.presentations.meeting_client_is_admitted", return_value=False):
            media_access = client.post(
                f"/api/presentations/{response.json()['presentationId']}/live/media-token",
                json={"displayName": "Public Guest", "clientId": "public-guest", "shareToken": response.json()['audienceUrl'].rsplit('/', 1)[-1]},
            )
    assert response.status_code == 200
    assert response.json()["accessCode"] is None
    assert "/join/" in response.json()["audienceUrl"]
    assert response.json()["controllerUrl"].endswith(f"controller.html?id={response.json()['presentationId']}")
    assert meetings.status_code == 200
    assert any(item["id"] == response.json()["id"] for item in meetings.json()["meetings"])
    assert access.status_code == 200
    assert access.json() == {"requiresCode": False}
    assert media_access.status_code == 200
    assert media_access.json()["permission"] == "viewer"


def test_create_private_scheduled_timed_meeting_generates_code_and_range():
    email = f"scheduled-owner-{uuid4().hex}@example.com"
    start = datetime.now(timezone.utc) + timedelta(days=1)
    end = start + timedelta(hours=2)
    with TestClient(fastapi_app) as client:
        signup = client.post("/api/auth/signup", json={"name": "Scheduled Owner", "email": email, "password": "securepass123"})
        response = client.post(
            "/api/meetings",
            json={
                "title": "Private planning room",
                "timingMode": "scheduled",
                "durationMode": "timed",
                "accessType": "private",
                "scheduledStart": start.isoformat(),
                "scheduledEnd": end.isoformat(),
            },
            headers={"Authorization": f"Bearer {signup.json()['accessToken']}"},
        )
        early_join = client.get(f"/api/presentations/shared/{response.json()['audienceUrl'].rsplit('/', 1)[-1]}")
    assert response.status_code == 200
    assert response.json()["status"] == "scheduled"
    assert response.json()["accessCode"].isdigit()
    assert len(response.json()["accessCode"]) == 4
    assert response.json()["scheduledEnd"] is not None
    assert early_join.status_code == 403
    assert "scheduled for" in early_join.json()["detail"]


def test_owner_can_extend_timed_meeting_and_share_expiry_tracks_end():
    email = f"meeting-extension-{uuid4().hex}@example.com"
    with TestClient(fastapi_app) as client:
        signup = client.post("/api/auth/signup", json={"name": "Meeting Owner", "email": email, "password": "securepass123"})
        headers = {"Authorization": f"Bearer {signup.json()['accessToken']}"}
        end = datetime.now(timezone.utc) + timedelta(minutes=10)
        created = client.post("/api/meetings", json={
            "title": "Timed room", "timingMode": "instant", "durationMode": "timed",
            "accessType": "public", "scheduledEnd": end.isoformat(),
        }, headers=headers)
        meeting_id = created.json()["id"]
        presentation_id = created.json()["presentationId"]
        extended = client.post(f"/api/meetings/{meeting_id}/extend", json={"minutes": 15}, headers=headers)
        resolved = client.get(f"/api/presentations/shared/{created.json()['audienceUrl'].rsplit('/', 1)[-1]}")
    assert created.status_code == 200
    assert extended.status_code == 200
    assert datetime.fromisoformat(extended.json()["scheduledEnd"]) > end + timedelta(minutes=14)
    assert resolved.status_code == 200
    assert resolved.json()["scheduledEnd"] == extended.json()["scheduledEnd"]
    with SessionLocal() as db:
        meeting = db.query(Meeting).filter_by(id=meeting_id).one()
        share = db.query(ShareLink).filter_by(presentation_id=presentation_id, permission="viewer").one()
        assert meeting.scheduled_end == share.expires_at


def test_only_owner_can_extend_timed_meeting():
    owner_email = f"meeting-extension-owner-{uuid4().hex}@example.com"
    guest_email = f"meeting-extension-guest-{uuid4().hex}@example.com"
    with TestClient(fastapi_app) as client:
        owner = client.post("/api/auth/signup", json={"name": "Owner", "email": owner_email, "password": "securepass123"})
        guest = client.post("/api/auth/signup", json={"name": "Guest", "email": guest_email, "password": "securepass123"})
        meeting = client.post("/api/meetings", json={
            "title": "Timed room", "timingMode": "instant", "durationMode": "timed",
            "accessType": "public", "scheduledEnd": (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat(),
        }, headers={"Authorization": f"Bearer {owner.json()['accessToken']}"})
        response = client.post(f"/api/meetings/{meeting.json()['id']}/extend", json={"minutes": 15}, headers={"Authorization": f"Bearer {guest.json()['accessToken']}"})
    assert response.status_code == 404


def test_share_link_requires_auth():
    with TestClient(fastapi_app) as client:
        response = client.post("/api/presentations/pres_demo/share")
    assert response.status_code == 401


def test_share_link_permissions_are_returned_to_frontend():
    with TestClient(fastapi_app) as client:
        login = client.post("/api/auth/login", json={"email": "owner@presentstudio.local", "password": "password123"})
        assert login.status_code == 200
        token = login.json()["accessToken"]
        headers = {"Authorization": f"Bearer {token}"}

        viewer_link = client.post(
            "/api/presentations/pres_demo/share",
            json={"permission": "viewer", "screenAccessCode": "8642"},
            headers=headers,
        )
        assert viewer_link.status_code == 200
        assert viewer_link.json()["permission"] == "viewer"
        assert viewer_link.json()["url"].startswith("https://")
        assert "/screen.html?" in viewer_link.json()["url"]

        viewer_payload = client.get(f"/api/presentations/pres_demo?token={viewer_link.json()['token']}")
        assert viewer_payload.status_code == 200
        assert viewer_payload.json()["permission"] == "viewer"

        presenter_link = client.post(
            "/api/presentations/pres_demo/share",
            json={"permission": "presenter", "screenAccessCode": "2468"},
            headers=headers,
        )
        assert presenter_link.status_code == 200
        assert presenter_link.json()["permission"] == "presenter"
        assert presenter_link.json()["requiresScreenCode"] is True
        assert presenter_link.json()["url"].startswith("https://")
        assert "/controller.html?" in presenter_link.json()["url"]
        assert "/screen.html?" in presenter_link.json()["screenUrl"]
        assert presenter_link.json()["screenToken"]
        assert "/join/" in presenter_link.json()["audienceUrl"]
        assert "?" not in presenter_link.json()["audienceUrl"]

        resolved_audience = client.get(f"/api/presentations/shared/{presenter_link.json()['screenToken']}")
        assert resolved_audience.status_code == 200
        assert resolved_audience.json()["presentationId"] == "pres_demo"

        audience_page = client.get(presenter_link.json()["audienceUrl"])
        assert audience_page.status_code == 200
        assert "Welcome to the presentation" in audience_page.text

        presenter_payload = client.get(f"/api/presentations/pres_demo?token={presenter_link.json()['token']}")
        assert presenter_payload.status_code == 200
        assert presenter_payload.json()["permission"] == "presenter"


def test_live_media_token_is_optional_and_requires_configuration():
    settings = get_settings()
    with patch.object(settings, "livekit_url", None), patch.object(settings, "livekit_api_key", None), patch.object(settings, "livekit_api_secret", None):
        with TestClient(fastapi_app) as client:
            login = client.post("/api/auth/login", json={"email": "owner@presentstudio.local", "password": "password123"})
            response = client.post(
                "/api/presentations/pres_demo/live/media-token",
                json={"displayName": "Presenter"},
                headers={"Authorization": f"Bearer {login.json()['accessToken']}"},
            )
    assert response.status_code == 503
    assert response.json()["detail"] == "Interactive audio/video is not configured"


def test_live_media_token_uses_presentation_as_room_and_protects_viewer_links():
    settings = get_settings()
    with TestClient(fastapi_app) as client:
        login = client.post("/api/auth/login", json={"email": "owner@presentstudio.local", "password": "password123"})
        headers = {"Authorization": f"Bearer {login.json()['accessToken']}"}
        link = client.post(
            "/api/presentations/pres_demo/share",
            json={"permission": "viewer", "screenAccessCode": "8642"},
            headers=headers,
        ).json()
    with TestClient(fastapi_app) as client:
        with patch.object(settings, "livekit_url", "wss://example.livekit.cloud"), patch.object(settings, "livekit_api_key", "key"), patch.object(settings, "livekit_api_secret", "secret"), patch("app.routers.presentations.create_livekit_join_token", return_value="signed-token") as signer:
            denied = client.post(
                "/api/presentations/pres_demo/live/media-token",
                json={"displayName": "Audience Member", "shareToken": link["token"], "screenAccessCode": "0000"},
            )
            accepted = client.post(
                "/api/presentations/pres_demo/live/media-token",
                json={"displayName": "  Audience   Member  ", "shareToken": link["token"], "screenAccessCode": "8642"},
            )
            invalid = client.post(
                "/api/presentations/pres_demo/live/media-token",
                json={"displayName": "Unknown", "shareToken": "invalid-token", "screenAccessCode": "8642"},
            )
    assert denied.status_code == 403
    assert invalid.status_code == 403
    assert accepted.status_code == 200
    assert accepted.json()["roomName"] == "pres_demo"
    assert accepted.json()["participantName"] == "Audience Member"
    assert accepted.json()["permission"] == "viewer"
    assert accepted.json()["token"] == "signed-token"
    assert accepted.json()["participantIdentity"].startswith("participant_")
    assert signer.call_args.args[0] == "pres_demo"


def test_livekit_tokens_publish_without_room_admin():
    from app.routers.presentations import create_livekit_join_token

    settings = get_settings()
    with patch.object(settings, "livekit_api_key", "test-key"), patch.object(settings, "livekit_api_secret", "test-secret"):
        tokens = [
            create_livekit_join_token("pres_demo", "participant_presenter", "Presenter", "presenter"),
            create_livekit_join_token("pres_demo", "participant_viewer", "Viewer", "viewer"),
        ]
    for token in tokens:
        claims = jwt.decode(token, "test-secret", algorithms=["HS256"], options={"verify_aud": False})
        grants = claims["video"]
        assert grants["roomJoin"] is True
        assert grants["room"] == "pres_demo"
        assert grants["canPublish"] is True
        assert grants["canSubscribe"] is True
        assert grants["canPublishData"] is False
        assert grants.get("roomAdmin", False) is False


def test_share_link_rejects_invalid_permission():
    with TestClient(fastapi_app) as client:
        login = client.post("/api/auth/login", json={"email": "owner@presentstudio.local", "password": "password123"})
        token = login.json()["accessToken"]

        response = client.post(
            "/api/presentations/pres_demo/share",
            json={"permission": "admin"},
            headers={"Authorization": f"Bearer {token}"},
        )
    assert response.status_code == 422


def test_presenter_share_link_requires_screen_code():
    with TestClient(fastapi_app) as client:
        login = client.post("/api/auth/login", json={"email": "owner@presentstudio.local", "password": "password123"})
        token = login.json()["accessToken"]
        response = client.post(
            "/api/presentations/pres_demo/share",
            json={"permission": "presenter"},
            headers={"Authorization": f"Bearer {token}"},
        )
    assert response.status_code == 422


def test_share_link_schema_repair_covers_legacy_runtime_columns():
    statements = share_link_repair_statements(
        "postgresql",
        {"id", "presentation_id", "token", "permission"},
    )

    assert "ALTER TABLE share_links ADD COLUMN screen_access_code_hash VARCHAR(255)" in statements
    assert "ALTER TABLE share_links ADD COLUMN is_active BOOLEAN DEFAULT TRUE NOT NULL" in statements
    assert "ALTER TABLE share_links ADD COLUMN expires_at TIMESTAMP WITH TIME ZONE" in statements
    assert "ALTER TABLE share_links ADD COLUMN created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP" in statements


def test_share_link_schema_repair_uses_sqlite_defaults():
    statements = share_link_repair_statements(
        "sqlite",
        {"id", "presentation_id", "token", "permission", "created_at"},
    )

    assert "ALTER TABLE share_links ADD COLUMN is_active BOOLEAN DEFAULT 1 NOT NULL" in statements
    assert "ALTER TABLE share_links ADD COLUMN expires_at DATETIME" in statements
    assert not any("created_at" in statement for statement in statements)


def test_screen_code_is_required_and_verified_for_protected_screen():
    email = f"screen-code-owner-{uuid4().hex}@example.com"
    with TestClient(fastapi_app) as client:
        signup = client.post(
            "/api/auth/signup",
            json={"name": "Screen Code Owner", "email": email, "password": "securepass123"},
        )
        token = signup.json()["accessToken"]
        headers = {"Authorization": f"Bearer {token}"}
        created = client.post(
            "/api/presentations",
            json={"title": "Protected screen deck"},
            headers=headers,
        )
        presentation_id = created.json()["presentation"]["id"]
        link = client.post(
            f"/api/presentations/{presentation_id}/share",
            json={"permission": "presenter", "screenAccessCode": "1357"},
            headers=headers,
        )
        share_token = link.json()["token"]
        screen_token = link.json()["screenToken"]

        requirements = client.get(f"/api/presentations/{presentation_id}/screen-access?token={share_token}")
        locked = client.get(f"/api/presentations/{presentation_id}?screen=1&token={share_token}")
        wrong = client.post(
            f"/api/presentations/{presentation_id}/screen-access",
            json={"token": share_token, "screenAccessCode": "2468"},
        )
        right = client.post(
            f"/api/presentations/{presentation_id}/screen-access",
            json={"token": share_token, "screenAccessCode": "1357"},
        )
        unlocked = client.get(f"/api/presentations/{presentation_id}?screen=1&token={share_token}&screenCode=1357")
        viewer_link = client.post(
            f"/api/presentations/{presentation_id}/share",
            json={"permission": "viewer", "screenAccessCode": "8642"},
            headers=headers,
        )
        viewer_token = viewer_link.json()["token"]
        viewer_requirements = client.get(f"/api/presentations/{presentation_id}/screen-access?token={viewer_token}")
        viewer_locked = client.get(f"/api/presentations/{presentation_id}?screen=1&token={viewer_token}")
        viewer_wrong = client.get(f"/api/presentations/{presentation_id}?screen=1&token={viewer_token}&screenCode=1357")
        viewer_unlocked = client.get(f"/api/presentations/{presentation_id}?screen=1&token={viewer_token}&screenCode=8642")
        paired_screen_requirements = client.get(f"/api/presentations/{presentation_id}/screen-access?token={screen_token}")
        paired_screen_locked = client.get(f"/api/presentations/{presentation_id}?screen=1&token={screen_token}")
        paired_screen_unlocked = client.get(f"/api/presentations/{presentation_id}?screen=1&token={screen_token}&screenCode=1357")

    assert signup.status_code == 200
    assert created.status_code == 200
    assert link.status_code == 200
    assert link.json()["screenUrl"].endswith(f"token={screen_token}")
    assert requirements.status_code == 200
    assert requirements.json() == {"requiresCode": True}
    assert locked.status_code == 403
    assert wrong.status_code == 403
    assert right.status_code == 200
    assert right.json() == {"ok": True}
    assert unlocked.status_code == 200
    assert unlocked.json()["permission"] == "presenter"
    assert viewer_link.status_code == 200
    assert viewer_link.json()["requiresScreenCode"] is True
    assert viewer_requirements.json() == {"requiresCode": True}
    assert viewer_locked.status_code == 403
    assert viewer_wrong.status_code == 403
    assert viewer_unlocked.status_code == 200
    assert viewer_unlocked.json()["permission"] == "viewer"
    assert paired_screen_requirements.json() == {"requiresCode": True}
    assert paired_screen_locked.status_code == 403
    assert paired_screen_unlocked.status_code == 200
    assert paired_screen_unlocked.json()["permission"] == "viewer"


def test_viewer_screen_link_requires_its_own_code():
    email = f"viewer-link-owner-{uuid4().hex}@example.com"
    with TestClient(fastapi_app) as client:
        signup = client.post(
            "/api/auth/signup",
            json={"name": "Viewer Link Owner", "email": email, "password": "securepass123"},
        )
        token = signup.json()["accessToken"]
        created = client.post(
            "/api/presentations",
            json={"title": f"Open viewer deck {uuid4().hex}"},
            headers={"Authorization": f"Bearer {token}"},
        )
        presentation_id = created.json()["presentation"]["id"]
        unprotected = client.post(
            f"/api/presentations/{presentation_id}/share",
            json={"permission": "viewer"},
            headers={"Authorization": f"Bearer {token}"},
        )
        link = client.post(
            f"/api/presentations/{presentation_id}/share",
            json={"permission": "viewer", "screenAccessCode": "9753"},
            headers={"Authorization": f"Bearer {token}"},
        )
        share_token = link.json()["token"]
        requirements = client.get(f"/api/presentations/{presentation_id}/screen-access?token={share_token}")
        screen = client.get(f"/api/presentations/{presentation_id}?screen=1&token={share_token}")
        unlocked = client.get(f"/api/presentations/{presentation_id}?screen=1&token={share_token}&screenCode=9753")

    assert signup.status_code == 200
    assert created.status_code == 200
    assert unprotected.status_code == 422
    assert link.status_code == 200
    assert link.json()["requiresScreenCode"] is True
    assert requirements.json() == {"requiresCode": True}
    assert screen.status_code == 403
    assert unlocked.status_code == 200


def test_saving_presentation_emits_live_update():
    with TestClient(fastapi_app) as client:
        login = client.post("/api/auth/login", json={"email": "owner@presentstudio.local", "password": "password123"})
        token = login.json()["accessToken"]
        headers = {"Authorization": f"Bearer {token}"}
        current = client.get("/api/presentations/pres_demo", headers=headers).json()["presentation"]

        with patch("app.routers.presentations.sio.emit", new_callable=AsyncMock) as emit:
            response = client.put("/api/presentations/pres_demo", json={**current, "baseUpdatedAt": current["updatedAt"]}, headers=headers)

        assert response.status_code == 200
        emit.assert_awaited_once()
        event_name, event = emit.await_args.args
        assert event_name == "presentation_updated"
        assert event["presentationId"] == "pres_demo"
        assert "presentation" not in event
        assert event["changes"]["slideOrder"]
        assert emit.await_args.kwargs["room"] == "pres_demo"


def test_saving_presentation_normalizes_duplicate_slide_ids():
    email = f"duplicate-slide-owner-{uuid4().hex}@example.com"
    with TestClient(fastapi_app) as client:
        signup = client.post(
            "/api/auth/signup",
            json={"name": "Duplicate Slide Owner", "email": email, "password": "securepass123"},
        )
        headers = {"Authorization": f"Bearer {signup.json()['accessToken']}"}
        created = client.post("/api/presentations", json={"title": "Duplicate slide save"}, headers=headers).json()["presentation"]
        duplicate_id = created["slides"][0]["id"]
        created["slides"] = [
            {**created["slides"][0], "id": duplicate_id, "order": 1, "title": "First"},
            {**created["slides"][0], "id": duplicate_id, "order": 2, "title": "Second"},
        ]
        response = client.put(f"/api/presentations/{created['id']}", json={**created, "baseUpdatedAt": created["updatedAt"]}, headers=headers)

    assert response.status_code == 200
    slide_ids = [slide["id"] for slide in response.json()["presentation"]["slides"]]
    assert len(slide_ids) == 2
    assert len(set(slide_ids)) == 2


def test_live_session_schema_repair_covers_postgres_media_columns():
    statements = live_session_repair_statements(
        "postgresql",
        {"id", "presentation_id", "active_slide_id", "presenter_user_id", "audience_count", "is_live", "updated_at"},
    )

    assert "ALTER TABLE live_sessions ADD COLUMN active_media_id VARCHAR(128)" in statements
    assert "ALTER TABLE live_sessions ADD COLUMN active_media_kind VARCHAR(16) DEFAULT 'slide' NOT NULL" in statements
    assert "ALTER TABLE live_sessions ADD COLUMN media_position FLOAT DEFAULT 0 NOT NULL" in statements
    assert "ALTER TABLE live_sessions ADD COLUMN media_playing BOOLEAN DEFAULT FALSE NOT NULL" in statements
    assert "ALTER TABLE live_sessions ADD COLUMN media_muted BOOLEAN DEFAULT FALSE NOT NULL" in statements
    assert "ALTER TABLE live_sessions ADD COLUMN media_updated_at TIMESTAMP WITH TIME ZONE" in statements
    assert "ALTER TABLE live_sessions ADD COLUMN featured_share_identity VARCHAR(128)" in statements
    assert "ALTER TABLE live_sessions ADD COLUMN featured_camera_identity VARCHAR(128)" in statements
    assert "ALTER TABLE live_sessions ADD COLUMN meeting_muted BOOLEAN DEFAULT FALSE NOT NULL" in statements
    assert "ALTER TABLE live_sessions ADD COLUMN muted_participant_identities TEXT DEFAULT '[]' NOT NULL" in statements


def test_meeting_control_payload_restores_persisted_override_state():
    live = LiveSession(
        id="live_test",
        presentation_id="pres_test",
        featured_share_identity="participant_screen_owner",
        featured_camera_identity="participant_camera_owner",
        meeting_muted=True,
        muted_participant_identities='["participant_one","participant_two"]',
    )

    assert meeting_control_payload(live, "pres_test") == {
        "presentationId": "pres_test",
        "featuredShareIdentity": "participant_screen_owner",
        "featuredCameraIdentity": "participant_camera_owner",
        "meetingMuted": True,
        "mutedParticipants": ["participant_one", "participant_two"],
    }


def test_meeting_control_partial_update_preserves_featured_share():
    owner_id = f"user_{uuid4().hex}"
    presentation_id = f"pres_{uuid4().hex}"
    live_id = f"live_{uuid4().hex}"
    with SessionLocal() as db:
        db.add(User(id=owner_id, name="Owner", email=f"{owner_id}@example.com", password_hash=hash_password("secret123")))
        db.add(Presentation(id=presentation_id, title="Live room", owner_id=owner_id))
        db.add(LiveSession(id=live_id, presentation_id=presentation_id, featured_share_identity="screen-owner", meeting_muted=False))
        db.commit()

    try:
        with patch.object(socket_manager, "can_present_with_credentials", return_value=True), patch.object(
            socket_manager.sio, "emit", new_callable=AsyncMock
        ):
            asyncio.run(socket_manager.meeting_control("host-sid", {
                "presentationId": presentation_id,
                "featuredCameraIdentity": "camera-owner",
                "meetingMuted": True,
                "mutedParticipants": ["participant-one"],
            }))

        with SessionLocal() as db:
            live = db.get(LiveSession, live_id)
            assert live.featured_share_identity == "screen-owner"
            assert live.featured_camera_identity == "camera-owner"
            assert live.meeting_muted is True
    finally:
        with SessionLocal() as db:
            live = db.get(LiveSession, live_id)
            presentation = db.get(Presentation, presentation_id)
            owner = db.get(User, owner_id)
            if live:
                db.delete(live)
            if presentation:
                db.delete(presentation)
            if owner:
                db.delete(owner)
            db.commit()


def test_signup_creates_authenticated_user():
    email = f"new-user-{uuid4().hex}@example.com"
    with TestClient(fastapi_app) as client:
        response = client.post("/api/auth/signup", json={"name": "New Presenter", "email": email, "password": "securepass123"})
        assert response.status_code == 200
        token = response.json()["accessToken"]
        profile = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})

    assert response.json()["user"]["email"] == email
    assert profile.status_code == 200
    assert profile.json()["user"]["name"] == "New Presenter"


def test_signup_rejects_invalid_email():
    with TestClient(fastapi_app) as client:
        response = client.post("/api/auth/signup", json={"name": "New Presenter", "email": "not-an-email", "password": "securepass123"})
    assert response.status_code == 400
    assert response.json()["detail"] == "Enter a valid email address"


def test_owner_can_delete_presentation():
    email = f"delete-owner-{uuid4().hex}@example.com"
    with TestClient(fastapi_app) as client:
        signup = client.post("/api/auth/signup", json={"name": "Delete Owner", "email": email, "password": "securepass123"})
        headers = {"Authorization": f"Bearer {signup.json()['accessToken']}"}
        created = client.post("/api/presentations", json={"title": "Delete me"}, headers=headers).json()["presentation"]
        client.post(f"/api/presentations/{created['id']}/share", json={"permission": "viewer", "screenAccessCode": "2468"}, headers=headers)
        other_login = client.post("/api/auth/login", json={"email": "owner@presentstudio.local", "password": "password123"})
        other_headers = {"Authorization": f"Bearer {other_login.json()['accessToken']}"}
        forbidden = client.delete(f"/api/presentations/{created['id']}", headers=other_headers)

        with patch("app.routers.presentations.sio.emit", new_callable=AsyncMock) as emit:
            deleted = client.delete(f"/api/presentations/{created['id']}", headers=headers)

        missing = client.get(f"/api/presentations/{created['id']}", headers=headers)

    assert deleted.status_code == 200
    assert forbidden.status_code == 404
    assert deleted.json() == {"ok": True, "presentationId": created["id"]}
    assert missing.status_code == 404
    emit.assert_awaited_once_with("presentation_deleted", {"presentationId": created["id"]}, room=created["id"])


def test_admin_dashboard_is_role_protected_and_reports_usage():
    admin_email = f"admin-{uuid4().hex}@example.com"
    owner_email = f"quota-owner-{uuid4().hex}@example.com"
    with TestClient(fastapi_app) as client:
        db = SessionLocal()
        try:
            db.add(
                User(
                    id=f"usr_{uuid4().hex}",
                    name="Test Administrator",
                    email=admin_email,
                    password_hash=hash_password("securepass123"),
                    role="admin",
                )
            )
            db.commit()
        finally:
            db.close()

        owner_signup = client.post(
            "/api/auth/signup",
            json={"name": "Quota Owner", "email": owner_email, "password": "securepass123"},
        )
        owner_headers = {"Authorization": f"Bearer {owner_signup.json()['accessToken']}"}
        forbidden = client.get("/api/admin/users", headers=owner_headers)
        protected_page = client.get("/admin.html", headers=owner_headers)

        admin_login = client.post("/api/auth/login", json={"email": admin_email, "password": "securepass123"})
        admin_headers = {"Authorization": f"Bearer {admin_login.json()['accessToken']}"}
        users = client.get("/api/admin/users", headers=admin_headers)

    assert forbidden.status_code == 403
    assert protected_page.status_code == 403
    assert users.status_code == 200
    owner_usage = next(item for item in users.json()["users"] if item["email"] == owner_email)
    assert owner_usage["presentationUsed"] == 0
    assert owner_usage["presentationRemaining"] == owner_usage["presentationLimit"]
    assert owner_usage["storageLimitBytes"] is None
    assert owner_usage["storageRemainingBytes"] is None
    assert owner_usage["storageStatus"] == "unlimited"


def test_admin_limit_prevents_additional_presentations():
    admin_email = f"limit-admin-{uuid4().hex}@example.com"
    owner_email = f"limited-owner-{uuid4().hex}@example.com"
    with TestClient(fastapi_app) as client:
        db = SessionLocal()
        try:
            db.add(
                User(
                    id=f"usr_{uuid4().hex}",
                    name="Limit Administrator",
                    email=admin_email,
                    password_hash=hash_password("securepass123"),
                    role="admin",
                )
            )
            db.commit()
        finally:
            db.close()

        owner_signup = client.post(
            "/api/auth/signup",
            json={"name": "Limited Owner", "email": owner_email, "password": "securepass123"},
        )
        owner = owner_signup.json()["user"]
        owner_headers = {"Authorization": f"Bearer {owner_signup.json()['accessToken']}"}
        admin_login = client.post("/api/auth/login", json={"email": admin_email, "password": "securepass123"})
        admin_headers = {"Authorization": f"Bearer {admin_login.json()['accessToken']}"}

        updated = client.patch(
            f"/api/admin/users/{owner['id']}/presentation-limit",
            json={"presentationLimit": 1},
            headers=admin_headers,
        )
        first = client.post("/api/presentations", json={"title": "Allowed"}, headers=owner_headers)
        blocked = client.post("/api/presentations", json={"title": "Blocked"}, headers=owner_headers)

    assert updated.status_code == 200
    assert updated.json()["user"]["presentationLimit"] == 1
    assert first.status_code == 200
    assert blocked.status_code == 409
    assert "Presentation limit reached (1/1)" in blocked.json()["detail"]


def test_admin_storage_limit_blocks_uploads_and_can_be_unlimited():
    admin_email = f"storage-admin-{uuid4().hex}@example.com"
    owner_email = f"storage-owner-{uuid4().hex}@example.com"
    with TestClient(fastapi_app) as client:
        db = SessionLocal()
        try:
            db.add(
                User(
                    id=f"usr_{uuid4().hex}",
                    name="Storage Administrator",
                    email=admin_email,
                    password_hash=hash_password("securepass123"),
                    role="admin",
                )
            )
            db.commit()
        finally:
            db.close()

        owner_signup = client.post(
            "/api/auth/signup",
            json={"name": "Storage Owner", "email": owner_email, "password": "securepass123"},
        )
        owner = owner_signup.json()["user"]
        owner_headers = {"Authorization": f"Bearer {owner_signup.json()['accessToken']}"}
        admin_login = client.post("/api/auth/login", json={"email": admin_email, "password": "securepass123"})
        admin_headers = {"Authorization": f"Bearer {admin_login.json()['accessToken']}"}

        limited = client.patch(
            f"/api/admin/users/{owner['id']}/storage-limit",
            json={"storageLimitBytes": 1},
            headers=admin_headers,
        )
        blocked = client.post(
            "/api/media/upload",
            headers=owner_headers,
            files={"file": ("blocked.png", b"xx", "image/png")},
        )
        unlimited = client.patch(
            f"/api/admin/users/{owner['id']}/storage-limit",
            json={"storageLimitBytes": None},
            headers=admin_headers,
        )

    assert limited.status_code == 200
    assert limited.json()["user"]["storageLimitBytes"] == 1
    assert blocked.status_code == 413
    assert "Media storage limit reached" in blocked.json()["detail"]
    assert unlimited.status_code == 200
    assert unlimited.json()["user"]["storageLimitBytes"] is None


def test_admin_can_revoke_user_and_owned_presentations_but_not_self():
    admin_email = f"revoke-admin-{uuid4().hex}@example.com"
    owner_email = f"revoked-owner-{uuid4().hex}@example.com"
    with TestClient(fastapi_app) as client:
        db = SessionLocal()
        try:
            administrator = User(
                id=f"usr_{uuid4().hex}",
                name="Revoke Administrator",
                email=admin_email,
                password_hash=hash_password("securepass123"),
                role="admin",
            )
            db.add(administrator)
            db.commit()
            admin_id = administrator.id
        finally:
            db.close()

        owner_signup = client.post(
            "/api/auth/signup",
            json={"name": "Revoked Owner", "email": owner_email, "password": "securepass123"},
        )
        owner = owner_signup.json()["user"]
        owner_headers = {"Authorization": f"Bearer {owner_signup.json()['accessToken']}"}
        created = client.post(
            "/api/presentations", json={"title": "Removed with owner"}, headers=owner_headers
        ).json()["presentation"]
        client.post(
            f"/api/presentations/{created['id']}/share",
            json={"permission": "viewer", "screenAccessCode": "2468"},
            headers=owner_headers,
        )

        admin_login = client.post("/api/auth/login", json={"email": admin_email, "password": "securepass123"})
        admin_headers = {"Authorization": f"Bearer {admin_login.json()['accessToken']}"}
        self_revoke = client.delete(f"/api/admin/users/{admin_id}", headers=admin_headers)
        revoked = client.delete(f"/api/admin/users/{owner['id']}", headers=admin_headers)
        rejected_login = client.post(
            "/api/auth/login", json={"email": owner_email, "password": "securepass123"}
        )

        db = SessionLocal()
        try:
            user_exists = db.get(User, owner["id"])
            presentation_exists = db.get(Presentation, created["id"])
        finally:
            db.close()

    assert self_revoke.status_code == 409
    assert revoked.status_code == 200
    assert revoked.json() == {"ok": True, "userId": owner["id"]}
    assert rejected_login.status_code == 401
    assert user_exists is None
    assert presentation_exists is None
