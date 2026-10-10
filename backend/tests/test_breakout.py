import asyncio
import time
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from fastapi import HTTPException

from app import breakout
from app.database import Base
from app.models import BreakoutAssignment, BreakoutRoom, LiveSession, MeetingParticipantGrant, Presentation, ShareLink, User
from app.security import create_access_token, create_participant_resume_token, resolve_participant_resume_token


@pytest.fixture
def setup(monkeypatch):
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    @event.listens_for(engine, "connect")
    def enable_foreign_keys(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine)
    monkeypatch.setattr(breakout, "SessionLocal", sessions)
    monkeypatch.setattr(breakout.sm, "active_participants", {})
    monkeypatch.setattr(breakout.sm, "controller_sids", {})
    monkeypatch.setattr(breakout.sm.sio, "emit", AsyncMock())
    monkeypatch.setattr(breakout.sm.sio, "enter_room", AsyncMock())
    monkeypatch.setattr(breakout.sm.sio, "leave_room", AsyncMock())
    monkeypatch.setattr(breakout, "evict", AsyncMock())
    with sessions() as db:
        user = User(id="owner", name="Host", email="host@test.local", password_hash="unused", role="owner")
        db.add(user)
        db.flush()
        db.add(Presentation(id="parent", title="Meeting", owner_id="owner", status="meeting"))
        db.flush()
        db.add(LiveSession(id="live", presentation_id="parent", meeting_instance_id="instance", is_live=True))
        db.flush()
        db.add(MeetingParticipantGrant(id="guestgrant", presentation_id="parent", meeting_instance_id="instance", guest_id="guest", display_name="Student", role="audience", status="approved"))
        db.commit()
        owner = {"presentationId": "parent", "authToken": create_access_token(user)}
        guest = {"presentationId": "parent", "resumeToken": create_participant_resume_token(db.get(MeetingParticipantGrant, "guestgrant"))}
    yield sessions, owner, guest
    engine.dispose()


def command(data, **values):
    return asyncio.run(breakout.breakout_rooms("socket", {**data, **values}))


def create(owner, name="Discussion"):
    result = command(owner, action="create", name=name)
    assert result["ok"], result
    return next(r for r in result["rooms"] if r["name"] == name)


def test_create_isolated_state_and_hide_roster_from_audience(setup):
    sessions, owner, guest = setup
    room = create(owner)
    with sessions() as db:
        child = db.get(Presentation, room["presentationId"])
        live = db.query(LiveSession).filter_by(presentation_id=child.id).one()
        assert child.status == "breakout"
        assert live.meeting_instance_id != "instance"
        assert live.whiteboard_document is None
        assert child.slides[0].canvas["elements"] == []
    result = command(guest)
    assert result["ok"] and not result["manager"] and result["participants"] == []


def test_audience_cannot_manage_or_join_an_unassigned_room(setup):
    sessions, owner, guest = setup
    room = create(owner)
    for action in ["create", "rename", "move", "visit", "announce", "auto-assign", "close-all"]:
        assert not command(guest, action=action, roomId=room["id"], guestIds=["guest"], name="Bad")["ok"]
    with sessions() as db:
        with pytest.raises(HTTPException):
            breakout.enforce_assignment(db, room["presentationId"], "guest")


def test_confirmed_move_persists_assignment_and_evicts_old_connection(setup):
    sessions, owner, guest = setup
    room = create(owner)
    breakout.sm.active_participants["parent"] = {"guest": {"sid": "student", "identity": "viewer-guest"}}
    result = command(owner, action="move", roomId=room["id"], guestIds=["guest"])
    assert result["ok"]
    breakout.evict.assert_awaited_once_with("parent", "viewer-guest")
    with sessions() as db:
        assert db.get(BreakoutAssignment, ("parent", "instance", "guest")).room_id == room["id"]
        breakout.enforce_assignment(db, room["presentationId"], "guest")
        with pytest.raises(HTTPException):
            breakout.enforce_assignment(db, "parent", "guest")
    transferred = command(guest)
    assert room["presentationId"] in transferred["url"]
    assert "resume=" in transferred["url"]


def test_invalid_group_is_rejected_before_any_eviction(setup):
    _, owner, _ = setup
    room = create(owner)
    result = command(owner, action="move", roomId=room["id"], guestIds=["guest", "outsider"])
    assert not result["ok"]
    breakout.evict.assert_not_awaited()


def test_transport_failure_does_not_commit_assignment(setup):
    sessions, owner, _ = setup
    room = create(owner)
    breakout.sm.active_participants["parent"] = {"guest": {"sid": "student", "identity": "viewer-guest"}}
    breakout.evict.side_effect = RuntimeError("network unavailable")
    assert not command(owner, action="move", roomId=room["id"], guestIds=["guest"])["ok"]
    with sessions() as db:
        assert db.get(BreakoutAssignment, ("parent", "instance", "guest")) is None


def test_room_delete_requires_empty_assignment(setup):
    _, owner, _ = setup
    room = create(owner)
    assert command(owner, action="move", roomId=room["id"], guestIds=["guest"])["ok"]
    assert not command(owner, action="delete", roomId=room["id"])["ok"]
    assert command(owner, action="move", roomId="main", guestIds=["guest"])["ok"]
    assert command(owner, action="delete", roomId=room["id"])["ok"]


def test_return_policy_is_authoritative_and_invalidates_old_child_credential(setup):
    sessions, owner, _ = setup
    room = create(owner)
    command(owner, action="move", roomId=room["id"], guestIds=["guest"])
    with sessions() as db:
        grant = db.query(MeetingParticipantGrant).filter_by(presentation_id=room["presentationId"], guest_id="guest").one()
        token = create_participant_resume_token(grant)
    child_guest = {"presentationId": room["presentationId"], "resumeToken": token}
    command(owner, action="return-policy", roomId=room["id"], allowReturn=False)
    assert not command(child_guest, action="return")["ok"]
    command(owner, action="return-policy", roomId=room["id"], allowReturn=True)
    assert command(child_guest, action="return")["ok"]
    with sessions() as db:
        assert resolve_participant_resume_token(db, token, room["presentationId"]) is None


def test_closing_deadline_survives_timer_loss_and_returns_offline_guest(setup):
    sessions, owner, _ = setup
    room = create(owner)
    command(owner, action="move", roomId=room["id"], guestIds=["guest"])
    result = command(owner, action="close-all")
    assert result["closingAt"] > time.time()
    with sessions() as db:
        db.get(BreakoutRoom, room["id"]).closing_at = time.time() - 1
        db.commit()
    result = command(owner)
    assert len(result["rooms"]) == 1
    with sessions() as db:
        assert db.get(BreakoutAssignment, ("parent", "instance", "guest")).room_id == "main"
        assert not db.query(LiveSession).filter_by(presentation_id=room["presentationId"]).one().is_live


def test_parent_session_restart_invalidates_child_access(setup):
    sessions, owner, _ = setup
    room = create(owner)
    command(owner, action="move", roomId=room["id"], guestIds=["guest"])
    with sessions() as db:
        grant = db.query(MeetingParticipantGrant).filter_by(presentation_id=room["presentationId"]).one()
        token = create_participant_resume_token(grant)
        db.get(LiveSession, "live").meeting_instance_id = "new-instance"
        db.commit()
        assert resolve_participant_resume_token(db, token, room["presentationId"]) is None
    assert not command({**owner, "presentationId": room["presentationId"]})["ok"]


def test_parent_cleanup_removes_child_records_with_foreign_keys_enabled(setup):
    sessions, owner, _ = setup
    room = create(owner)
    command(owner, action="move", roomId=room["id"], guestIds=["guest"])
    with sessions() as db:
        assert breakout.cleanup_children(db, "parent") == [room["presentationId"]]
        db.commit()
        assert db.get(Presentation, room["presentationId"]) is None
        assert db.query(BreakoutAssignment).count() == 0
        assert db.query(BreakoutRoom).count() == 0


def test_cohost_can_manage_and_visit_but_parent_demotion_revokes_child_access(setup):
    sessions, owner, _ = setup
    room = create(owner)
    with sessions() as db:
        grant = db.get(MeetingParticipantGrant, "guestgrant")
        grant.role = "cohost"
        share = breakout.mv._ensure_cohost_share(db, grant)
        token = share.token
        db.commit()
    cohost = {"presentationId": "parent", "shareToken": token}
    result = command(cohost, action="visit", roomId=room["id"])
    assert result["ok"] and "cohost=1" in result["url"]
    from urllib.parse import parse_qs, urlsplit
    child_token = parse_qs(urlsplit(result["url"]).query)["token"][0]
    child = {"presentationId": room["presentationId"], "shareToken": child_token}
    assert command(child)["manager"]
    with sessions() as db:
        db.get(MeetingParticipantGrant, "guestgrant").role = "audience"
        db.commit()
    assert not command(child)["ok"]


def test_owner_can_visit_breakout_and_return_without_losing_owner_access(setup):
    sessions, owner, _ = setup
    room = create(owner)
    result = command(owner, action="visit", roomId=room["id"])
    assert result["ok"]
    from urllib.parse import parse_qs, urlsplit
    query = parse_qs(urlsplit(result["url"]).query)
    assert query["id"] == [room["presentationId"]]
    assert query["breakoutJoin"] == ["1"]
    child_token = query["token"][0]
    with sessions() as db:
        share = db.query(ShareLink).filter_by(token=child_token).one()
        assert share.presentation_id == room["presentationId"]
        assert share.permission == "presenter"
        assert share.expires_at is not None
    child_owner = {**owner, "presentationId": room["presentationId"], "shareToken": child_token}
    assert command(child_owner)["manager"]
    back = command(child_owner, action="visit", roomId="main")
    assert back["ok"] and back["url"] == "/controller.html?id=parent"


def test_room_limit_and_duplicate_names_are_rejected(setup):
    _, owner, _ = setup
    create(owner, "Discussion")
    assert not command(owner, action="create", name="discussion")["ok"]
    for number in range(19):
        create(owner, f"Group {number}")
    assert not command(owner, action="create", name="Overflow")["ok"]
    assert not asyncio.run(breakout.breakout_rooms("socket", None))["ok"]


def test_child_admission_does_not_subscribe_an_unverified_socket(setup, monkeypatch):
    sessions, owner, _ = setup
    room = create(owner)
    monkeypatch.setattr(breakout.mv, "SessionLocal", sessions)
    monkeypatch.setattr(breakout.sm.sio, "get_session", AsyncMock(return_value={"breakout_guest_id": "guest", "breakout_presentation_id": "other-room"}))
    breakout.sm.sio.enter_room.reset_mock()
    asyncio.run(breakout.mv.meeting_admission_request("intruder", {"presentationId": room["presentationId"], "clientId": "guest", "name": "Intruder"}))
    breakout.sm.sio.enter_room.assert_not_awaited()


def test_ending_parent_during_transport_eviction_aborts_transfer(setup):
    sessions, owner, _ = setup
    room = create(owner)
    breakout.sm.active_participants["parent"] = {"guest": {"sid": "student", "identity": "viewer-guest"}}
    def close_parent(*_):
        with sessions() as db:
            db.get(LiveSession, "live").is_live = False
            db.commit()
    breakout.evict.side_effect = close_parent
    result = command(owner, action="move", roomId=room["id"], guestIds=["guest"])
    assert not result["ok"]
    with sessions() as db:
        assert db.get(BreakoutAssignment, ("parent", "instance", "guest")) is None


def test_child_removal_and_explicit_readmission_keep_parent_grant_consistent(setup, monkeypatch):
    sessions, owner, _ = setup
    room = create(owner)
    command(owner, action="move", roomId=room["id"], guestIds=["guest"])
    monkeypatch.setattr(breakout.mv, "SessionLocal", sessions)
    monkeypatch.setattr(breakout.sm, "SessionLocal", sessions)
    monkeypatch.setattr(breakout.sm, "waiting_participants", {})
    monkeypatch.setattr(breakout.sm, "screen_share_requests", {})
    breakout.sm.active_participants[room["presentationId"]] = {"guest": {"sid": "student", "clientId": "guest", "name": "Student", "identity": "viewer-guest"}}
    child_owner = {**owner, "presentationId": room["presentationId"], "clientId": "guest"}
    asyncio.run(breakout.mv.meeting_remove_participant("host", child_owner))
    with sessions() as db:
        assert db.get(MeetingParticipantGrant, "guestgrant").status == "revoked"
        assert db.get(BreakoutAssignment, ("parent", "instance", "guest")).room_id == "main"
    asyncio.run(breakout.mv.meeting_admission_decide("host", {**child_owner, "accepted": True}))
    with sessions() as db:
        assert db.get(MeetingParticipantGrant, "guestgrant").status == "approved"
        assert db.get(BreakoutAssignment, ("parent", "instance", "guest")).room_id == room["id"]
