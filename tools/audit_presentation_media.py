"""Read-only presentation media audit.

Run on a trusted backend host with DATABASE_URL configured:
  PYTHONPATH=backend python tools/audit_presentation_media.py --presentation-id pres_...
It never modifies PostgreSQL or S3; output includes image counts and asset IDs only.
"""
import argparse
import json
from collections import Counter

from app.database import SessionLocal
from app.models import MediaAsset, Presentation, PresentationSnapshot, Slide


def identities(canvas):
    canvas = canvas if isinstance(canvas, dict) else {}
    fabric = canvas.get("fabric") or {}
    objects = fabric.get("objects", []) if isinstance(fabric, dict) else []
    images = [obj for obj in objects if isinstance(obj, dict) and obj.get("type") == "image"]
    return Counter(str(obj.get("id") or obj.get("src") or "") for obj in images)


def audit(presentation_id):
    with SessionLocal() as db:
        pres = db.get(Presentation, presentation_id)
        if not pres:
            raise ValueError("Presentation not found")
        assets = db.query(MediaAsset).filter(MediaAsset.owner_id == pres.owner_id).all()
        slide_rows = db.query(Slide).filter(Slide.presentation_id == presentation_id).order_by(Slide.order).all()
        snapshots = db.query(PresentationSnapshot).filter(
            PresentationSnapshot.presentation_id == presentation_id
        ).order_by(PresentationSnapshot.created_at.desc()).limit(30).all()
        slides = []
        for slide in slide_rows:
            current = identities(slide.canvas)
            historical = Counter()
            best_snapshot = None
            for snap in snapshots:
                previous = next((s for s in snap.document.get("slides", []) if s.get("id") == slide.id), None)
                if not previous:
                    continue
                old = identities(previous.get("canvas"))
                missing = old - current
                if sum(missing.values()) > sum(historical.values()):
                    historical = missing
                    best_snapshot = snap.id
            slides.append({
                "slideId": slide.id, "slideTitle": slide.title,
                "currentImageCount": sum(current.values()),
                "potentiallyMissingImageCount": sum(historical.values()),
                "candidateRecoverySnapshotId": best_snapshot,
                "missingObjectIds": list(historical.elements()),
            })
        return {
            "presentationId": pres.id,
            "slideCount": len(slides),
            "mediaLibraryAssetCount": len(assets),
            "snapshotCount": len(snapshots),
            "slides": slides,
            "note": "A missing object in a historical snapshot is a recovery candidate, not proof it was unintentionally deleted. Review before restoring. Previously lost placement data may require old PostgreSQL backups.",
        }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--presentation-id", required=True)
    args = parser.parse_args()
    print(json.dumps(audit(args.presentation_id), indent=2))
