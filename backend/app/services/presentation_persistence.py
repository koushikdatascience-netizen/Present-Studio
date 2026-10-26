"""Synchronous save work runs in a worker thread with its own DB session."""
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import String, cast, update

from ..database import SessionLocal
from ..live_state import apply_controller_state, live_session_payload
from ..models import LiveSession, Presentation, Slide, User
from ..schemas import PresentationOut, SlideOut
from ..security import can_edit_presentation, new_id
from .presentation_images import externalize_images


def utc(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def persist_presentation(presentation_id, payload, user_id):
    with SessionLocal() as db:
        user = db.get(User, user_id)
        presentation = db.query(Presentation).filter(Presentation.id == presentation_id).with_for_update().first()
        if not user or not user.is_active or not presentation or not can_edit_presentation(db, presentation, user):
            raise HTTPException(404, "Presentation not found")
        if payload.updatedAt is None:
            raise HTTPException(428, "Reload the saved presentation before editing. A saved version is required.")
        previous = presentation.updated_at
        if utc(payload.updatedAt) != utc(previous):
            raise HTTPException(409, "Another editor saved this presentation. Download your unsaved copy, then reload the saved version.")
        # Compare-and-swap also protects SQLite, where FOR UPDATE is ignored.
        next_version = max(datetime.now(timezone.utc), utc(previous) + timedelta(microseconds=1))
        version_matches = Presentation.updated_at == previous
        if db.bind.dialect.name == "sqlite":
            # SQLite CURRENT_TIMESTAMP omits .000000, while bound datetimes
            # include it. Compare exact equivalent spellings, without truncating
            # fractional seconds (which would permit same-millisecond races).
            spellings = {previous.isoformat(sep=" "), previous.isoformat(sep=" ", timespec="microseconds")}
            version_matches = cast(Presentation.updated_at, String).in_(spellings)
        result = db.execute(update(Presentation).where(
            Presentation.id == presentation_id, version_matches,
        ).values(updated_at=next_version).execution_options(synchronize_session=False))
        if result.rowcount != 1:
            raise HTTPException(409, "Another editor saved this presentation. Download your unsaved copy, then reload the saved version.")
        canvases = externalize_images(db, presentation.owner_id, [slide.canvas for slide in payload.slides])
        presentation.title = payload.title.strip() or "Untitled presentation"
        presentation.updated_at = next_version
        existing = {slide.id: slide for slide in db.query(Slide).filter(Slide.presentation_id == presentation_id).all()}
        before = {s.id: SlideOut(id=s.id, order=s.order, title=s.title, canvas=s.canvas or {}).model_dump() for s in existing.values()}
        ids = set()
        saved = []
        for incoming, scene in zip(payload.slides, canvases):
            slide_id = incoming.id.strip()[:64]
            # Never overwrite another presentation's slide, even with a supplied ID.
            collision = db.get(Slide, slide_id) if slide_id and slide_id not in existing else None
            if not slide_id or slide_id in ids or collision is not None:
                slide_id = new_id("slide")
            ids.add(slide_id)
            slide = existing.get(slide_id)
            if slide is None:
                slide = Slide(id=slide_id, presentation_id=presentation_id)
                db.add(slide)
            slide.order = incoming.order
            slide.title = incoming.title.strip()[:255] or "Untitled Slide"
            if slide.canvas != scene:
                slide.canvas = scene
            saved.append(slide)
        for slide_id, slide in existing.items():
            if slide_id not in ids:
                db.delete(slide)
        live = db.query(LiveSession).filter(LiveSession.presentation_id == presentation_id).with_for_update().first()
        if live and live.active_slide_id not in ids:
            if saved:
                apply_controller_state(live, slide_id=saved[0].id)
            else:
                live.active_slide_id = None
                live.active_media_id = None
                live.active_media_kind = "slide"
                live.media_position = 0
                live.media_playing = False
        # Capture the response and delta while the row lock is still held. A
        # later save must not supply this response's version or slide contents.
        db.flush()
        db.refresh(presentation)
        serialized = PresentationOut(id=presentation.id, title=presentation.title, ownerId=presentation.owner_id,
                                     status=presentation.status, updatedAt=presentation.updated_at.isoformat(),
                                     slides=[SlideOut(id=s.id, order=s.order, title=s.title, canvas=s.canvas or {})
                                             for s in sorted(saved, key=lambda s: s.order)])
        event = {"presentationId": presentation_id, "baseUpdatedAt": previous.isoformat(),
                 "changes": {"title": serialized.title, "status": serialized.status, "updatedAt": serialized.updatedAt,
                             "slides": [s.model_dump() for s in serialized.slides if before.get(s.id) != s.model_dump()],
                             "slideOrder": [s.id for s in serialized.slides]},
                 "activeSlideId": live.active_slide_id if live else (saved[0].id if saved else None),
                 "liveState": live_session_payload(live, presentation_id)}
        db.commit()
        return serialized, event
