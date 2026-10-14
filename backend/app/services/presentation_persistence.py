"""Synchronous save work runs in a worker thread with its own DB session."""
from datetime import datetime, timezone

from fastapi import HTTPException

from ..database import SessionLocal
from ..live_state import apply_controller_state, live_session_payload
from ..models import LiveSession, Presentation, Slide, User
from ..schemas import PresentationOut, SlideOut
from ..security import can_edit_presentation, new_id
from .presentation_images import externalize_images


def persist_presentation(presentation_id, payload, user_id):
    with SessionLocal() as db:
        user = db.get(User, user_id)
        presentation = db.query(Presentation).filter(Presentation.id == presentation_id).with_for_update().first()
        if not user or not user.is_active or not presentation or not can_edit_presentation(db, presentation, user):
            raise HTTPException(404, "Presentation not found")
        canvases = externalize_images(db, presentation.owner_id, [slide.canvas for slide in payload.slides])
        presentation.title = payload.title.strip() or "Untitled presentation"
        presentation.updated_at = datetime.now(timezone.utc)
        existing = {slide.id: slide for slide in db.query(Slide).filter(Slide.presentation_id == presentation_id).all()}
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
        db.commit()
        serialized = PresentationOut(id=presentation.id, title=presentation.title, ownerId=presentation.owner_id,
                                     status=presentation.status, updatedAt=presentation.updated_at.isoformat(),
                                     slides=[SlideOut(id=s.id, order=s.order, title=s.title, canvas=s.canvas or {})
                                             for s in sorted(saved, key=lambda s: s.order)])
        event = {"presentationId": presentation_id, "presentation": serialized.model_dump(),
                 "activeSlideId": live.active_slide_id if live else (saved[0].id if saved else None),
                 "liveState": live_session_payload(live, presentation_id)}
        return serialized, event
