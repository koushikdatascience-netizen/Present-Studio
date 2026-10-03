from datetime import datetime, timezone
import secrets
import hashlib
import json

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import LiveSession, Meeting, Presentation, ShareLink, Slide, User, MeetingParticipantGrant, PresentationMember
from ..schemas import MeetingCreate, MeetingOut
from ..security import current_user, hash_password, new_id, new_share_token
from ..socket_manager import sio
from .presentations import public_share_base_url


router = APIRouter(prefix="/api/meetings", tags=["meetings"])


def aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def meeting_status(meeting: Meeting, now: datetime | None = None) -> str:
    now = now or datetime.now(timezone.utc)
    if meeting.status == "closed":
        return "closed"
    start = aware(meeting.scheduled_start)
    end = aware(meeting.scheduled_end) if meeting.scheduled_end else None
    if end and now >= end:
        return "ended"
    if now < start:
        return "scheduled"
    return "ready"


def serialize_meeting(meeting: Meeting, presentation: Presentation, share: ShareLink, request: Request, access_code: str | None = None) -> MeetingOut:
    base = public_share_base_url(request)
    scenes = [slide.canvas for slide in presentation.slides]
    has_media = any(scene.get("elements") or (scene.get("fabric") or {}).get("objects") for scene in scenes if scene)
    revision = hashlib.sha256(("preview-v2:" + json.dumps(scenes, sort_keys=True)).encode()).hexdigest()[:12] if has_media else ""
    return MeetingOut(
        id=meeting.id,
        presentationId=presentation.id,
        title=presentation.title,
        timingMode=meeting.timing_mode,
        durationMode=meeting.duration_mode,
        accessType=meeting.access_type,
        scheduledStart=aware(meeting.scheduled_start).isoformat(),
        scheduledEnd=aware(meeting.scheduled_end).isoformat() if meeting.scheduled_end else None,
        status=meeting_status(meeting),
        audienceUrl=f"{base}/join/{share.token}" + (f"?preview={revision}" if revision else ""),
        controllerUrl=f"{base}/controller.html?id={presentation.id}",
        accessCode=access_code,
    )


@router.get("")
def list_meetings(request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, list[MeetingOut]]:
    rows = (
        db.query(Meeting, Presentation, ShareLink)
        .join(Presentation, Presentation.id == Meeting.presentation_id)
        .join(ShareLink, ShareLink.id == Meeting.audience_share_id)
        .filter(Meeting.owner_id == user.id)
        .order_by(Meeting.scheduled_start.desc())
        .all()
    )
    return {"meetings": [serialize_meeting(meeting, presentation, share, request) for meeting, presentation, share in rows]}


@router.get("/by-presentation/{presentation_id}")
def meeting_for_presentation(presentation_id: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)) -> MeetingOut:
    row = (
        db.query(Meeting, Presentation, ShareLink)
        .join(Presentation, Presentation.id == Meeting.presentation_id)
        .join(ShareLink, ShareLink.id == Meeting.audience_share_id)
        .filter(Meeting.presentation_id == presentation_id, Meeting.owner_id == user.id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return serialize_meeting(*row, request)


@router.post("")
def create_meeting(payload: MeetingCreate, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)) -> MeetingOut:
    now = datetime.now(timezone.utc)
    start = aware(payload.scheduledStart) if payload.timingMode == "scheduled" and payload.scheduledStart else now
    if payload.timingMode == "scheduled" and not payload.scheduledStart:
        raise HTTPException(status_code=422, detail="Scheduled meetings require a start date and time")
    if payload.timingMode == "scheduled" and start <= now:
        raise HTTPException(status_code=422, detail="Scheduled meeting time must be in the future")
    end = aware(payload.scheduledEnd) if payload.durationMode == "timed" and payload.scheduledEnd else None
    if payload.durationMode == "timed" and not end:
        raise HTTPException(status_code=422, detail="Timed meetings require an end date and time")
    if end and end <= start:
        raise HTTPException(status_code=422, detail="Meeting end time must be after its start time")

    suffix = secrets.token_hex(8)
    title = payload.title.strip() or ("Scheduled meeting" if payload.timingMode == "scheduled" else "Instant meeting")
    presentation = Presentation(id=f"pres_{suffix}", title=title, owner_id=user.id, status="meeting")
    slide = Slide(id=f"slide_{suffix}", presentation_id=presentation.id, order=1, title=title, canvas={"background": "#ffffff", "elements": []})
    access_code = f"{secrets.randbelow(10000):04d}" if payload.accessType == "private" else None
    share = ShareLink(
        id=new_id("share"),
        presentation_id=presentation.id,
        token=new_share_token(),
        permission="viewer",
        screen_access_code_hash=hash_password(access_code) if access_code else None,
        expires_at=end,
    )
    meeting = Meeting(
        id=new_id("meeting"),
        presentation_id=presentation.id,
        owner_id=user.id,
        audience_share_id=share.id,
        timing_mode=payload.timingMode,
        duration_mode=payload.durationMode,
        access_type=payload.accessType,
        scheduled_start=start,
        scheduled_end=end,
        status="ready",
    )
    live = LiveSession(
        id=new_id("live"),
        presentation_id=presentation.id,
        meeting_instance_id=new_id("meeting"),
        active_slide_id=slide.id,
        presenter_user_id=user.id,
        is_live=True,
    )
    # Persist parent records first so PostgreSQL foreign keys are satisfied.
    db.add(presentation)
    db.flush()

    db.add_all([slide, share])
    db.flush()

    db.add_all([meeting, live])
    db.commit()
    return serialize_meeting(meeting, presentation, share, request, access_code)


@router.delete("/{meeting_id}")
async def delete_meeting(
    meeting_id: str,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict[str, str | bool]:
    meeting = db.get(Meeting, meeting_id)

    if not meeting or meeting.owner_id != user.id:
        raise HTTPException(
            status_code=404,
            detail="Meeting not found",
        )

    presentation_id = meeting.presentation_id

    try:
        # Remove participant grants first.
        db.query(MeetingParticipantGrant).filter(
            MeetingParticipantGrant.presentation_id == presentation_id
        ).delete(synchronize_session=False)

        # Meeting references both presentation and audience share.
        # Delete it before deleting the ShareLink.
        db.delete(meeting)
        db.flush()

        db.query(PresentationMember).filter(
            PresentationMember.presentation_id == presentation_id
        ).delete(synchronize_session=False)

        # LiveSession can reference the generated slide.
        db.query(LiveSession).filter(
            LiveSession.presentation_id == presentation_id
        ).delete(synchronize_session=False)

        db.query(ShareLink).filter(
            ShareLink.presentation_id == presentation_id
        ).delete(synchronize_session=False)

        db.query(Slide).filter(
            Slide.presentation_id == presentation_id
        ).delete(synchronize_session=False)

        presentation = db.get(Presentation, presentation_id)
        if presentation:
            db.delete(presentation)

        db.commit()

    except Exception:
        db.rollback()
        raise

    # Immediately invalidate/close any currently-open audience pages.
    await sio.emit(
        "presentation_deleted",
        {"presentationId": presentation_id},
        room=presentation_id,
    )

    return {
        "ok": True,
        "meetingId": meeting_id,
        "presentationId": presentation_id,
    }
