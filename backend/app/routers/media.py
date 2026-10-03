from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from sqlalchemy import func
from sqlalchemy.orm import Session
import cloudinary
import cloudinary.uploader
import logging
import subprocess
import tempfile
import uuid
from pathlib import Path
from fastapi.responses import RedirectResponse
from starlette.concurrency import run_in_threadpool
from ..config import get_settings
from ..database import get_db
from ..models import LiveSession, MediaAsset, MeetingParticipantGrant, Presentation, User
from ..schemas import MediaAssetOut
from ..security import can_edit_presentation, can_present_with_credentials, current_user, new_id, optional_current_user


router = APIRouter(prefix="/api/media", tags=["media"])
logger = logging.getLogger(__name__)


def s3_storage():
    from ..services.s3_storage import get_s3_storage
    return get_s3_storage()


def store_upload(content, content_type, filename, *, asset_id=None, owner_id=None, presentation_id=None):
    settings = get_settings()
    if settings.storage_provider.lower() == "s3":
        storage = s3_storage()
        object_id = asset_id or uuid.uuid4().hex
        key = storage.media_key(owner_id, asset_id) if asset_id else storage.meeting_key(presentation_id, object_id)
        try:
            storage.upload_bytes(content=content, key=key, content_type=content_type)
        except Exception as exc:
            logger.error("S3 upload failed (%s)", type(exc).__name__)
            raise HTTPException(status_code=502, detail="Object storage upload failed. Please try again.") from exc
        if asset_id and content_type.startswith("video/"):
            # Social apps require an image poster, not a video URL, for link cards.
            try:
                with tempfile.TemporaryDirectory() as directory:
                    source = Path(directory) / "source"
                    poster = Path(directory) / "poster.jpg"
                    source.write_bytes(content)
                    subprocess.run(["ffmpeg", "-nostdin", "-y", "-i", str(source), "-frames:v", "1", "-vf", "scale=1200:-2", str(poster)], check=True, capture_output=True, timeout=30)
                    storage.upload_bytes(content=poster.read_bytes(), key=f"{key}.jpg", content_type="image/jpeg")
            except Exception:
                logger.warning("Video poster generation failed for %s", asset_id)
        return f"/api/media/{asset_id}/content" if asset_id else f"/api/media/meeting-content/{presentation_id}/{object_id}"
    configure_cloudinary()
    resource_type = "image" if content_type.startswith("image/") else "video" if content_type.startswith(("video/", "audio/")) else "raw"
    result = cloudinary.uploader.upload(content, folder=settings.cloudinary_folder, resource_type=resource_type, filename=filename)
    return result["secure_url"]


@router.get("/{asset_id}/content", name="serve_media_asset")
def serve_media_asset(asset_id: str, db: Session = Depends(get_db)):
    asset = db.get(MediaAsset, asset_id)
    if not asset or asset.url != f"/api/media/{asset_id}/content":
        raise HTTPException(status_code=404, detail="Media not found")
    storage = s3_storage()
    return RedirectResponse(storage.presigned_get(storage.media_key(asset.owner_id, asset.id)), status_code=307, headers={"Cache-Control": "private, no-store"})


@router.get("/{asset_id}/thumbnail")
def serve_media_thumbnail(asset_id: str, db: Session = Depends(get_db)):
    asset = db.get(MediaAsset, asset_id)
    if not asset or not asset.mime_type.startswith("video/") or asset.url != f"/api/media/{asset_id}/content":
        raise HTTPException(status_code=404, detail="Thumbnail not found")
    storage = s3_storage()
    key = f"{storage.media_key(asset.owner_id, asset.id)}.jpg"
    try:
        storage.client.head_object(Bucket=storage.bucket, Key=key)
    except Exception:
        return RedirectResponse("/assets/snapkey.png", status_code=307)
    return RedirectResponse(storage.presigned_get(key), status_code=307, headers={"Cache-Control": "private, no-store"})


@router.get("/meeting-content/{presentation_id}/{object_id}")
def serve_meeting_attachment(presentation_id: str, object_id: str):
    if len(object_id) != 32 or any(char not in "0123456789abcdef" for char in object_id):
        raise HTTPException(status_code=404, detail="Attachment not found")
    storage = s3_storage()
    return RedirectResponse(storage.presigned_get(storage.meeting_key(presentation_id, object_id)), status_code=307, headers={"Cache-Control": "private, no-store"})


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

    content_type = file.content_type or ""
    if not content_type.startswith(("image/", "video/", "audio/")):
        raise HTTPException(status_code=415, detail="Only image, video, and audio files are supported")
    if not content:
        raise HTTPException(status_code=400, detail="Choose a file to upload")
    asset_id = new_id("asset")
    url = await run_in_threadpool(store_upload, content, content_type, file.filename, asset_id=asset_id, owner_id=user.id)
    asset = MediaAsset(
        id=asset_id,
        owner_id=user.id,
        name=file.filename or "upload",
        mime_type=file.content_type or "application/octet-stream",
        url=url,
        size=len(content),
    )
    db.add(asset)
    try:
        db.commit()
    except Exception:
        db.rollback()
        if get_settings().storage_provider.lower() == "s3":
            try:
                storage = s3_storage()
                storage.delete(storage.media_key(user.id, asset_id))
            except Exception:
                logger.warning("Unable to clean up failed media upload %s", asset_id)
        raise
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

    content_type = file.content_type or "application/octet-stream"
    url = await run_in_threadpool(store_upload, content, content_type, file.filename or "attachment", presentation_id=presentation_id)
    return {
        "attachment": {
            "name": (file.filename or "attachment")[:180],
            "mimeType": content_type[:120],
            "size": len(content),
            "url": url,
        }
    }
