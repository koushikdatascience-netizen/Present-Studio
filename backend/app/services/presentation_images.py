"""Move embedded raster images out of slide JSON without changing their bytes."""
import base64
import binascii
from copy import deepcopy
from hashlib import sha256
from io import BytesIO

from fastapi import HTTPException
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import func

from ..config import get_settings
from ..models import MediaAsset, User
from .s3_storage import get_s3_storage

MAX_IMAGE_BYTES = 100 * 1024 * 1024


def image_preview(content: bytes) -> bytes:
    with Image.open(BytesIO(content)) as original:
        # Reject decompression bombs rather than decoding an unbounded image.
        if original.width * original.height > 40_000_000:
            raise ValueError("Image dimensions exceed preview limit")
        image = ImageOps.exif_transpose(original)
        image.thumbnail((320, 180), Image.Resampling.LANCZOS)
        if image.mode not in ("RGB", "RGBA"):
            image = image.convert("RGBA" if "transparency" in image.info else "RGB")
        output = BytesIO()
        image.save(output, format="WEBP", quality=80)
        return output.getvalue()


def externalize_images(db, owner_id: str, canvases: list[dict]) -> list[dict]:
    """Preserve all scene metadata; deduplicate image assets per owner.

    Caller owns the transaction. Unsupported formats remain unchanged. Storage
    failure aborts the save, so a missing object can never replace inline data.
    """
    result = deepcopy(canvases)
    if get_settings().storage_provider.lower() != "s3":
        return result
    replacements = {}
    owner = None
    used = 0

    def visit(value):
        nonlocal owner, used
        if isinstance(value, list):
            for item in value:
                visit(item)
        elif isinstance(value, dict):
            src = value.get("src")
            if isinstance(src, str) and src.startswith("data:image/") and ";base64," in src:
                mime, encoded = src.split(";base64,", 1)
                mime = mime[5:].lower()
                if mime not in {"image/png", "image/jpeg", "image/webp", "image/gif"}:
                    return
                if len(encoded) > MAX_IMAGE_BYTES * 4 // 3 + 4:
                    raise HTTPException(413, "Embedded image exceeds 100 MB")
                key = sha256(src.encode()).hexdigest()
                if key not in replacements:
                    try:
                        content = base64.b64decode(encoded, validate=True)
                        if not content or len(content) > MAX_IMAGE_BYTES:
                            raise ValueError("Invalid image size")
                        preview = image_preview(content)
                    except (ValueError, binascii.Error, UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
                        raise HTTPException(422, "Embedded image could not be decoded; upload it again") from exc
                    if owner is None:
                        owner = db.query(User).filter(User.id == owner_id).with_for_update().one()
                        used = db.query(func.coalesce(func.sum(MediaAsset.size), 0)).filter(MediaAsset.owner_id == owner_id).scalar() or 0
                    asset_id = "asset_img_" + sha256(owner_id.encode()).hexdigest()[:12] + sha256(content).hexdigest()[:40]
                    asset = db.get(MediaAsset, asset_id)
                    if asset is None:
                        if owner.storage_limit_bytes is not None and used + len(content) > owner.storage_limit_bytes:
                            raise HTTPException(413, "Media storage limit reached; increase storage before saving embedded images")
                        storage = get_s3_storage()
                        object_key = storage.media_key(owner_id, asset_id)
                        storage.upload_bytes(content=content, key=object_key, content_type=mime)
                        storage.upload_bytes(content=preview, key=object_key + ".preview.webp", content_type="image/webp")
                        asset = MediaAsset(id=asset_id, owner_id=owner_id, name="Slide image", mime_type=mime,
                                           size=len(content), url=f"/api/media/{asset_id}/content")
                        db.add(asset)
                        db.flush()
                        used += len(content)
                    replacements[key] = (asset.url, f"/api/media/{asset_id}/image-preview")
                value["src"], value["thumbnailSrc"] = replacements[key]
            for child in value.values():
                if isinstance(child, (list, dict)):
                    visit(child)

    visit(result)
    return result


def lightweight_cover(canvas: dict) -> dict:
    """Limit dashboard cover data without mutating the saved slide."""
    def clean(value, depth=0):
        if depth > 12:
            return None
        if isinstance(value, dict):
            result = {key: clean(item, depth + 1) for key, item in value.items()
                      if key not in {"notes", "audio", "audioSrc", "audioName", "playback"}}
            if result.get("thumbnailSrc"):
                result["src"] = result["thumbnailSrc"]
            return result
        if isinstance(value, list):
            return [clean(item, depth + 1) for item in value[:100]]
        if isinstance(value, str):
            if value.startswith("data:") or len(value) > 4096:
                return ""
        return value

    return clean({key: canvas[key] for key in ("background", "fabric", "elements") if key in canvas})
