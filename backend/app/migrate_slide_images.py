"""Dry-run by default. Back up selected scenes before migrating idle decks."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path

from .database import SessionLocal
from .models import LiveSession, Presentation, Slide
from .services.presentation_images import externalize_images


def embedded_count(value):
    if isinstance(value, dict):
        src = value.get("src")
        return int(isinstance(src, str) and src.startswith("data:image/")) + sum(embedded_count(v) for v in value.values() if isinstance(v, (dict, list)))
    if isinstance(value, list):
        return sum(embedded_count(v) for v in value)
    return 0


def migrate(*, apply=False, backup=None, presentation_id=None):
    with SessionLocal() as db:
        query = db.query(Presentation)
        if presentation_id:
            query = query.filter(Presentation.id == presentation_id)
        candidates = []
        skipped = 0
        for deck in query.all():
            live = db.query(LiveSession).filter(LiveSession.presentation_id == deck.id).first()
            if live and live.is_live:
                skipped += 1
                continue
            slides = db.query(Slide).filter(Slide.presentation_id == deck.id).all()
            if any(embedded_count(s.canvas) for s in slides):
                candidates.append({"id": deck.id, "slides": [{"id": s.id, "canvas": s.canvas} for s in slides]})
    if not apply:
        return {"eligibleDecks": len(candidates), "embeddedImages": sum(embedded_count(s["canvas"]) for d in candidates for s in d["slides"]), "liveDecksSkipped": skipped}
    if not backup:
        raise ValueError("--backup is required when applying migration")
    # 'x' refuses to overwrite an earlier recovery file.
    with Path(backup).open("x", encoding="utf-8") as output:
        json.dump(candidates, output)
    migrated = 0
    for snapshot in candidates:
        with SessionLocal() as db:
            deck = db.query(Presentation).filter(Presentation.id == snapshot["id"]).with_for_update().first()
            if not deck:
                continue
            live = db.query(LiveSession).filter(LiveSession.presentation_id == deck.id).with_for_update().first()
            if live and live.is_live:
                continue
            slides = db.query(Slide).filter(Slide.presentation_id == deck.id).with_for_update().all()
            before = {s["id"]: s["canvas"] for s in snapshot["slides"]}
            if {s.id: s.canvas for s in slides} != before:
                continue  # Somebody edited after the backup; keep their work.
            converted = externalize_images(db, deck.owner_id, [s.canvas for s in slides])
            for slide, scene in zip(slides, converted):
                slide.canvas = scene
            deck.updated_at = datetime.now(timezone.utc)
            db.commit()
            migrated += 1
    return {"migratedDecks": migrated, "liveDecksSkipped": skipped, "backup": str(backup)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--backup")
    parser.add_argument("--presentation-id")
    args = parser.parse_args()
    print(json.dumps(migrate(apply=args.apply, backup=args.backup, presentation_id=args.presentation_id)))
