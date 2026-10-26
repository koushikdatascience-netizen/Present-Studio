"""Protect existing slide content and test owner-approved recovery.

These tests use an isolated in-memory database; production DB/S3 is never touched.
"""
import asyncio
from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Presentation, PresentationSnapshot, Slide, User
from app.routers import presentations as routes
from app.schemas import PresentationSave, SlideIn


@pytest.fixture
def data(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, autoflush=False)()
    user = User(id="u1", name="Owner", email="owner@example.test", password_hash="test", role="owner")
    pres = Presentation(id="p1", title="Live deck", owner_id="u1", status="draft")
    slide = Slide(id="s1", presentation_id="p1", title="Slide", order=1,
                  canvas={"background": "#fff", "fabric": {"objects": [
                      {"id": "title", "type": "textbox", "text": "Keep me"}]}})
    db.add_all([user, pres, slide])
    db.commit()
    db.refresh(pres)
    monkeypatch.setattr(routes.sio, "emit", AsyncMock())
    yield db, user, pres, slide
    db.close()
    engine.dispose()


def test_restore_missing_images_preserves_current_text(data):
    db, user, pres, slide = data
    db.add(PresentationSnapshot(id="before", presentation_id=pres.id, owner_id=user.id,
        document={"title": pres.title, "slides": [{"id": slide.id, "canvas": {
            "fabric": {"objects": [{"id": "old-photo", "type": "image", "src": "/api/media/asset1/content"}]}}}]}))
    db.commit()
    version = db.get(Presentation, pres.id).updated_at.isoformat()
    result = asyncio.run(routes.restore_missing_slide_images(
        pres.id, "before", {"slideId": slide.id, "baseUpdatedAt": version}, user=user, db=db))
    assert result["restored"] == 1
    objects = db.get(Slide, slide.id).canvas["fabric"]["objects"]
    assert {item["id"] for item in objects} == {"old-photo", "title"}


def test_stale_restore_rejected(data):
    db, user, pres, slide = data
    with pytest.raises(HTTPException) as exc:
        asyncio.run(routes.restore_missing_slide_images(
            pres.id, "missing", {"slideId": slide.id, "baseUpdatedAt": "old-version"}, user=user, db=db))
    assert exc.value.status_code == 409


def test_stale_editor_save_rejected_without_deleting_images(data):
    db, user, pres, slide = data
    slide.canvas = {"fabric": {"objects": [{"id": "old-photo", "type": "image", "src": "/api/media/asset1/content"}]}}
    db.commit()
    payload = PresentationSave(
        id=pres.id, title="Stale", baseUpdatedAt="1970-01-01T00:00:00+00:00",
        slides=[SlideIn(id=slide.id, order=1, title="Stale", canvas={"fabric": {"objects": []}})],
    )
    with pytest.raises(HTTPException) as exc:
        asyncio.run(routes.save_presentation(pres.id, payload, user=user, db=db))
    assert exc.value.status_code == 409
    db.expire_all()
    assert len(db.get(Slide, slide.id).canvas["fabric"]["objects"]) == 1
