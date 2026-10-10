"""Isolated browser-test app. Never imported by the production application."""
import os
import tempfile
from pathlib import Path

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

database = os.environ.get("DATABASE_URL", "")
path = Path(database.removeprefix("sqlite:///")).resolve()
if not database.startswith("sqlite:///") or path.parent.parent != Path(tempfile.gettempdir()).resolve() or not path.parent.name.startswith("snapkey-breakout-test-"):
    raise RuntimeError("The breakout fixture requires an isolated temporary database")

from app import breakout
from app.main import fastapi_app, app
from app.database import get_db
from app.models import LiveSession, MeetingParticipantGrant, Presentation, User
from app.security import create_participant_resume_token, current_user, new_id


async def fake_transport_eviction(presentation_id, identity):
    # Browser tests exercise real authorization/socket routing, not LiveKit transport.
    return None


breakout.evict = fake_transport_eviction


@fastapi_app.post("/__test/guest")
def guest_fixture(data: dict, user: User = Depends(current_user), db: Session = Depends(get_db)):
    presentation = db.get(Presentation, data.get("presentationId"))
    if not presentation or presentation.owner_id != user.id:
        raise HTTPException(403)
    live = db.query(LiveSession).filter_by(presentation_id=presentation.id).one()
    grant = MeetingParticipantGrant(id=new_id("grant"), presentation_id=presentation.id, meeting_instance_id=live.meeting_instance_id,
        guest_id=data["guestId"], display_name=data["name"], role="audience", status="approved")
    db.add(grant)
    db.commit()
    return {"resume": create_participant_resume_token(grant, minutes=60)}


fastapi_app.router.routes.insert(0, fastapi_app.router.routes.pop())
