from datetime import datetime, timedelta, timezone
import secrets
from uuid import uuid4
import jwt
from fastapi import Depends, HTTPException, Request, status
from passlib.context import CryptContext
from sqlalchemy.orm import Session
from .config import get_settings
from .database import get_db
from .models import BreakoutRoom, LiveSession, MeetingParticipantGrant, Presentation, PresentationMember, ShareLink, User


pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex}"


def new_share_token() -> str:
    """Return a compact, URL-safe token with 96 bits of entropy."""
    return secrets.token_urlsafe(12)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return pwd_context.verify(password, password_hash)


def create_access_token(user: User) -> str:
    settings = get_settings()
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_minutes)
    payload = {"sub": user.id, "email": user.email, "role": user.role, "exp": expires_at}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def create_participant_resume_token(grant: MeetingParticipantGrant, minutes: int = 10) -> str:
    """Create a short-lived audience credential for a demoted co-host."""
    settings = get_settings()
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=max(1, minutes))
    payload = {
        "typ": "participant_resume",
        "sub": grant.guest_id,
        "presentationId": grant.presentation_id,
        "meetingInstanceId": grant.meeting_instance_id,
        "permission": "audience",
        "name": grant.display_name or "Guest",
        "exp": expires_at,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def breakout_access_active(db, presentation_id):
    child = db.query(BreakoutRoom).filter_by(presentation_id=presentation_id).first()
    if not child:
        return True
    parent = db.query(LiveSession).filter_by(presentation_id=child.parent_id).first()
    return bool(not child.closed and parent and parent.is_live and parent.meeting_instance_id == child.instance_id)


def breakout_grant_active(db, presentation_id, guest_id, role=None):
    child = db.query(BreakoutRoom).filter_by(presentation_id=presentation_id).first()
    if not child:
        return True
    parent = db.query(MeetingParticipantGrant).filter_by(presentation_id=child.parent_id, meeting_instance_id=child.instance_id, guest_id=guest_id).first()
    return bool(parent and parent.status == "approved" and (role is None or parent.role == role))


def resolve_participant_resume_token(
    db: Session,
    token: str,
    presentation_id: str,
) -> tuple[MeetingParticipantGrant, dict] | None:
    """Validate a resume credential against the current live meeting grant."""
    if not token or not presentation_id:
        return None
    if not breakout_access_active(db, presentation_id):
        return None
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError:
        return None
    if (
        payload.get("typ") != "participant_resume"
        or payload.get("permission") != "audience"
        or payload.get("presentationId") != presentation_id
    ):
        return None
    meeting_instance_id = str(payload.get("meetingInstanceId") or "")
    guest_id = str(payload.get("sub") or "")
    live = db.query(LiveSession).filter(LiveSession.presentation_id == presentation_id).first()
    if not live or not live.is_live or live.meeting_instance_id != meeting_instance_id:
        return None
    grant = db.query(MeetingParticipantGrant).filter(
        MeetingParticipantGrant.presentation_id == presentation_id,
        MeetingParticipantGrant.meeting_instance_id == meeting_instance_id,
        MeetingParticipantGrant.guest_id == guest_id,
    ).first()
    if not grant or grant.status != "approved" or grant.role != "audience":
        return None
    if not breakout_grant_active(db, presentation_id, guest_id):
        return None
    return grant, payload


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    auth_header = request.headers.get("authorization", "")
    token = auth_header.removeprefix("Bearer ").strip() if auth_header.lower().startswith("bearer ") else ""
    if not token:
        token = request.cookies.get("present_studio_token", "")
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token") from exc

    user = db.get(User, payload.get("sub"))
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid user")
    return user


def admin_user(user: User = Depends(current_user)) -> User:
    if user.role.lower() != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Administrator access required")
    return user


def user_from_token(db: Session, token: str) -> User | None:
    if not token:
        return None
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError:
        return None
    user = db.get(User, payload.get("sub"))
    return user if user and user.is_active else None


def optional_current_user(request: Request, db: Session) -> User | None:
    auth_header = request.headers.get("authorization", "")
    token = auth_header.removeprefix("Bearer ").strip() if auth_header.lower().startswith("bearer ") else ""
    if not token:
        token = request.cookies.get("present_studio_token", "")
    return user_from_token(db, token)


def can_edit_presentation(db: Session, presentation: Presentation, user: User) -> bool:
    if presentation.owner_id == user.id:
        return True
    member = db.query(PresentationMember).filter(
        PresentationMember.presentation_id == presentation.id,
        PresentationMember.user_id == user.id,
    ).first()
    return bool(member and member.role in {"owner", "editor"})


def can_view_presentation(db: Session, presentation: Presentation, user: User) -> bool:
    if can_edit_presentation(db, presentation, user):
        return True
    member = db.query(PresentationMember).filter(
        PresentationMember.presentation_id == presentation.id,
        PresentationMember.user_id == user.id,
    ).first()
    return bool(member and member.role in {"viewer", "editor", "owner"})


def resolve_share_permission(db: Session, presentation_id: str, token: str) -> str | None:
    if not breakout_access_active(db, presentation_id):
        return None
    share = db.query(ShareLink).filter(
        ShareLink.token == token,
        ShareLink.presentation_id == presentation_id,
        ShareLink.is_active == True,  # noqa: E712
    ).first()
    if not share:
        return None

    expires_at = share.expires_at
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at and expires_at <= datetime.now(timezone.utc):
        return None

    cohost_grant = db.query(MeetingParticipantGrant).filter(
        MeetingParticipantGrant.cohost_share_id == share.id
    ).first()
    if cohost_grant:
        if not breakout_grant_active(db, presentation_id, cohost_grant.guest_id, "cohost"):
            return None
        live = db.query(LiveSession).filter(
            LiveSession.presentation_id == presentation_id
        ).first()
        if (
            not live
            or not live.is_live
            or live.meeting_instance_id != cohost_grant.meeting_instance_id
            or cohost_grant.status != "approved"
            or cohost_grant.role != "cohost"
        ):
            return None

    if share.permission not in {"viewer", "presenter"}:
        return "viewer"
    return share.permission


def can_present_with_credentials(db: Session, presentation: Presentation, auth_token: str = "", share_token: str = "") -> bool:
    user = user_from_token(db, auth_token)
    if user and can_edit_presentation(db, presentation, user):
        return True
    return resolve_share_permission(db, presentation.id, share_token) == "presenter"
