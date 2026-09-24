from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from sqlalchemy import func
from sqlalchemy.orm import Session
import cloudinary
import cloudinary.uploader
from ..config import get_settings
from ..database import get_db
from ..models import LiveSession, MediaAsset, MeetingParticipantGrant, Presentation, User
from ..schemas import MediaAssetOut
from ..security import can_edit_presentation, can_present_with_credentials, current_user, new_id, optional_current_user


router = APIRouter(prefix="/api/media", tags=["media"])


def configure_cloudinary() -> None:
    settings = get_settings()
    if not settings.cloudinary_cloud_name or not settings.cloudinary_api_key or not settings.cloudinary_api_secret:
        raise HTTPException(status_code=500, detail="Cloudinary is not configured")
    cloudinary.config(
        cloud_name=settings.cloudinary_cloud_name,
        api_key=settings.cloudinary_api_key,
        api_secret=settings.cloudinary_api_secret,
        secure=True,
    )


@router.get("")
def list_media(
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict[str, list[MediaAssetOut]]:
    assets = db.query(MediaAsset).filter(MediaAsset.owner_id == user.id).order_by(MediaAsset.created_at.desc()).all()
    return {
        "assets": [
            MediaAssetOut(id=asset.id, name=asset.name, mimeType=asset.mime_type, url=asset.url, size=asset.size)
            for asset in assets
        ]
    }


@router.post("/upload")
async def upload_media(
    file: UploadFile = File(...),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict[str, MediaAssetOut]:
    content = await file.read()
    if len(content) > 100 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Maximum upload size is 100 MB")

    quota_user = db.query(User).filter(User.id == user.id).with_for_update().one()
    storage_used = db.query(func.coalesce(func.sum(MediaAsset.size), 0)).filter(MediaAsset.owner_id == user.id).scalar() or 0
    if quota_user.storage_limit_bytes is not None and int(storage_used) + len(content) > quota_user.storage_limit_bytes:
        remaining = max(quota_user.storage_limit_bytes - int(storage_used), 0)
        raise HTTPException(
            status_code=413,
            detail=f"Media storage limit reached. {remaining} bytes remaining; this upload requires {len(content)} bytes.",
        )

    configure_cloudinary()
    settings = get_settings()
    content_type = file.content_type or ""
    if not content_type.startswith(("image/", "video/", "audio/")):
        raise HTTPException(status_code=415, detail="Only image, video, and audio files are supported")
    resource_type = "image" if content_type.startswith("image/") else "video"
    result = cloudinary.uploader.upload(
        content,
        folder=settings.cloudinary_folder,
        resource_type=resource_type,
        filename=file.filename,
    )
    asset = MediaAsset(
        id=new_id("asset"),
        owner_id=user.id,
        name=file.filename or "upload",
        mime_type=file.content_type or "application/octet-stream",
        url=result["secure_url"],
        size=len(content),
    )
    db.add(asset)
    db.commit()
    return {
        "asset": MediaAssetOut(
            id=asset.id,
            name=asset.name,
            mimeType=asset.mime_type,
            url=asset.url,
            size=asset.size,
        )
    }


@router.post("/meeting-upload")
async def upload_meeting_file(
    request: Request,
    presentation_id: str = Form(...),
    client_id: str = Form(...),
    share_token: str = Form(""),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> dict:
    """Upload a meeting-chat attachment for an admitted participant or presenter."""
    presentation = db.get(Presentation, presentation_id)
    if not presentation:
        raise HTTPException(status_code=404, detail="Presentation not found")

    user = optional_current_user(request, db)
    allowed = bool(user and can_edit_presentation(db, presentation, user))
    if not allowed and share_token:
        allowed = can_present_with_credentials(db, presentation, share_token=share_token)
    if not allowed:
        live = db.query(LiveSession).filter(
            LiveSession.presentation_id == presentation_id,
            LiveSession.is_live.is_(True),
        ).first()
        if live and live.meeting_instance_id and client_id:
            grant = db.query(MeetingParticipantGrant).filter(
                MeetingParticipantGrant.presentation_id == presentation_id,
                MeetingParticipantGrant.meeting_instance_id == live.meeting_instance_id,
                MeetingParticipantGrant.guest_id == client_id[:128],
                MeetingParticipantGrant.status == "approved",
                MeetingParticipantGrant.role.in_(("audience", "cohost")),
            ).first()
            allowed = grant is not None
    if not allowed:
        raise HTTPException(status_code=403, detail="Join the meeting before uploading files")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Choose a file to upload")
    if len(content) > 100 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Maximum upload size is 100 MB")

    configure_cloudinary()
    settings = get_settings()
    content_type = file.content_type or "application/octet-stream"
    if content_type.startswith("image/"):
        resource_type = "image"
    elif content_type.startswith(("video/", "audio/")):
        resource_type = "video"
    else:
        resource_type = "raw"

    result = cloudinary.uploader.upload(
        content,
        folder=f"{settings.cloudinary_folder}/meeting-chat/{presentation_id}",
        resource_type=resource_type,
        filename=file.filename or "attachment",
        use_filename=True,
        unique_filename=True,
    )
    return {
        "attachment": {
            "name": (file.filename or "attachment")[:180],
            "mimeType": content_type[:120],
            "size": len(content),
            "url": result["secure_url"],
        }
    }
