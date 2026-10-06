"""Breakouts reuse isolated presentation state rather than sharing parent data."""
import asyncio
import time
import logging
from weakref import WeakValueDictionary
from urllib.parse import urlencode

from fastapi import HTTPException

from . import socket_manager as sm
from .config import get_settings
from .database import SessionLocal
from .models import BreakoutRoom, BreakoutAssignment, LiveSession, MeetingParticipantGrant, Presentation, PresentationMember, ShareLink, Slide
from .security import can_present_with_credentials, create_participant_resume_token, new_id, resolve_participant_resume_token
from . import meeting_v2 as mv

_locks = WeakValueDictionary()
logger = logging.getLogger(__name__)


def room_lock(parent_id):
    lock = _locks.get(parent_id)
    if lock is None:
        lock = asyncio.Lock()
        _locks[parent_id] = lock
    return lock


def context(db, source):
    child = db.query(BreakoutRoom).filter_by(presentation_id=source).first()
    parent_id = child.parent_id if child else source
    live = db.query(LiveSession).filter_by(presentation_id=parent_id).first()
    if not live or not live.is_live or not live.meeting_instance_id:
        raise HTTPException(409, "The main meeting is not live")
    if child and (child.instance_id != live.meeting_instance_id or child.closed):
        raise HTTPException(409, "This breakout room is closed")
    return parent_id, live, child


def cleanup_children(db, parent_id):
    children = db.query(BreakoutRoom).filter_by(parent_id=parent_id).all()
    child_ids = [r.presentation_id for r in children]
    db.query(BreakoutAssignment).filter_by(parent_id=parent_id).delete(synchronize_session=False)
    db.query(BreakoutRoom).filter_by(parent_id=parent_id).delete(synchronize_session=False)
    for child_id in child_ids:
        db.query(MeetingParticipantGrant).filter_by(presentation_id=child_id).delete(synchronize_session=False)
        db.query(PresentationMember).filter_by(presentation_id=child_id).delete(synchronize_session=False)
        db.query(LiveSession).filter_by(presentation_id=child_id).delete(synchronize_session=False)
        db.query(ShareLink).filter_by(presentation_id=child_id).delete(synchronize_session=False)
        db.query(Slide).filter_by(presentation_id=child_id).delete(synchronize_session=False)
        db.query(Presentation).filter_by(id=child_id).delete(synchronize_session=False)
    return child_ids


def assigned_presentation(db, parent_id, instance_id, guest_id):
    assignment = db.get(BreakoutAssignment, (parent_id, instance_id, guest_id))
    if not assignment or assignment.room_id == "main":
        return parent_id
    room = db.get(BreakoutRoom, assignment.room_id)
    return room.presentation_id if room and not room.closed else parent_id


def enforce_assignment(db, presentation_id, guest_id):
    parent_id, live, _ = context(db, presentation_id)
    if assigned_presentation(db, parent_id, live.meeting_instance_id, guest_id) != presentation_id:
        raise HTTPException(403, "You have been assigned to another meeting room")


def authorize(db, data, *, manage=False):
    source = str(data.get("presentationId") or "")
    parent_id, live, child = context(db, source)
    presentation = db.get(Presentation, source)
    controller = bool(presentation and can_present_with_credentials(db, presentation,
        auth_token=data.get("authToken") or "", share_token=data.get("shareToken") or ""))
    resumed = resolve_participant_resume_token(db, data.get("resumeToken") or "", source)
    if not controller and not resumed:
        raise HTTPException(403, "An active meeting credential is required")
    if manage and not controller:
        raise HTTPException(403, "Host or co-host permission required")
    if controller and child and data.get("shareToken") and not data.get("authToken"):
        share = db.query(mv.ShareLink).filter_by(token=data["shareToken"]).first()
        local = db.query(MeetingParticipantGrant).filter_by(cohost_share_id=share.id).first() if share else None
        original = mv._grant(db, parent_id, live.meeting_instance_id, local.guest_id) if local else None
        if not original or original.status != "approved" or original.role != "cohost":
            raise HTTPException(403, "Main-meeting co-host permission required")
    return parent_id, live, child, controller, resumed[0] if resumed else None


def rooms_for(db, parent_id, instance):
    return db.query(BreakoutRoom).filter_by(parent_id=parent_id, instance_id=instance, closed=False).order_by(BreakoutRoom.name, BreakoutRoom.id).all()


def snapshot(db, parent_id, live, manager):
    rooms = rooms_for(db, parent_id, live.meeting_instance_id)
    grants = db.query(MeetingParticipantGrant).filter_by(presentation_id=parent_id,
        meeting_instance_id=live.meeting_instance_id, status="approved").all()
    assignments = {a.guest_id: a.room_id for a in db.query(BreakoutAssignment).filter_by(parent_id=parent_id, instance_id=live.meeting_instance_id)}
    connected = set()
    for pid in [parent_id, *[r.presentation_id for r in rooms]]:
        connected.update(sm.active_participants.get(pid, {}))
    return {"parentId": parent_id, "manager": manager,
        "closingAt": min((r.closing_at for r in rooms if r.closing_at), default=None),
        "rooms": [{"id": "main", "name": "Main room", "presentationId": parent_id, "allowReturn": True},
                  *[{"id": r.id, "name": r.name, "presentationId": r.presentation_id, "allowReturn": r.allow_return} for r in rooms]],
        "participants": [{"id": g.guest_id, "name": g.display_name, "roomId": assignments.get(g.guest_id, "main"),
                          "connected": g.guest_id in connected} for g in grants] if manager else []}


def transfer_url(db, parent_id, live, guest_id, destination):
    original = mv._grant(db, parent_id, live.meeting_instance_id, guest_id)
    if not original or original.status != "approved":
        raise HTTPException(403, "Participant no longer has meeting access")
    target_live = db.query(LiveSession).filter_by(presentation_id=destination).first()
    grant = mv._upsert_grant(db, destination, target_live.meeting_instance_id, guest_id,
                            original.display_name, role=original.role)
    if original.role == "cohost":
        share = mv._ensure_cohost_share(db, grant)
        return mv._controller_url(grant, share.token) + "&breakoutJoin=1"
    return "/present.html?" + urlencode({"id": destination, "resume": create_participant_resume_token(grant, minutes=720)})


async def evict(presentation_id, identity):
    """Remove the old LiveKit participant before a cross-room transfer."""
    if not identity:
        return
    from livekit import api
    settings = get_settings()
    client = api.LiveKitAPI(settings.livekit_url, settings.livekit_api_key, settings.livekit_api_secret)
    try:
        try:
            await asyncio.wait_for(client.room.remove_participant(api.RoomParticipantIdentity(room=presentation_id, identity=identity)), timeout=8)
        except api.TwirpError as exc:
            if exc.code != "not_found":
                raise
    finally:
        await client.aclose()


async def move(db, parent_id, live, guest_ids, room_id):
    if room_id == "main":
        destination = parent_id
    else:
        target = db.get(BreakoutRoom, room_id)
        if not target or target.parent_id != parent_id or target.instance_id != live.meeting_instance_id or target.closed:
            raise HTTPException(404, "Room not found")
        destination = target.presentation_id
    notifications = []
    for guest_id in guest_ids:
        original = mv._grant(db, parent_id, live.meeting_instance_id, guest_id)
        if not original or original.status != "approved":
            raise HTTPException(422, "Only admitted participants can be moved")
    expected_instance = live.meeting_instance_id
    work = []
    for guest_id in guest_ids:
        source = assigned_presentation(db, parent_id, live.meeting_instance_id, guest_id)
        if source == destination:
            continue
        item = sm.active_participants.get(source, {}).get(guest_id)
        work.append((guest_id, source, dict(item) if item else None))
    semaphore = asyncio.Semaphore(10)

    async def remove_old_connection(source, item):
        if not item:
            return
        async with semaphore:
            room_name = "Main room" if room_id == "main" else target.name
            await sm.sio.emit("breakout_transfer_pending", {"roomName": room_name}, room=item["sid"])
            await evict(source, item.get("identity"))

    outcomes = await asyncio.gather(*[remove_old_connection(source, item) for _, source, item in work], return_exceptions=True)
    failure = next((result for result in outcomes if isinstance(result, BaseException)), None)
    if failure:
        raise failure
    db.expire_all()
    _, current, _ = context(db, parent_id)
    if current.meeting_instance_id != expected_instance:
        raise HTTPException(409, "The meeting session changed during the transfer")
    for guest_id, source, item in work:
        url = transfer_url(db, parent_id, live, guest_id, destination)
        if source != parent_id:
            old_live = db.query(LiveSession).filter_by(presentation_id=source).first()
            old = mv._grant(db, source, old_live.meeting_instance_id, guest_id)
            if old:
                mv._revoke_cohost_share(db, old)
                old.status = "revoked"
        assignment = db.get(BreakoutAssignment, (parent_id, live.meeting_instance_id, guest_id))
        if not assignment:
            assignment = BreakoutAssignment(parent_id=parent_id, instance_id=live.meeting_instance_id, guest_id=guest_id, room_id=room_id)
            db.add(assignment)
        else:
            assignment.room_id = room_id
        if item:
            notifications.append((item["sid"], url, guest_id))
            await sm.sio.leave_room(item["sid"], source)
            await sm.sio.leave_room(item["sid"], "whiteboard:" + source)
    db.commit()
    for sid, url, guest_id in notifications:
        return_url = transfer_url(db, parent_id, live, guest_id, parent_id)
        db.commit()
        await sm.sio.emit("breakout_transfer", {"url": url, "returnUrl": return_url, "parentId": parent_id}, room=sid)


async def finish_closure(db, parent_id, live):
    rooms = rooms_for(db, parent_id, live.meeting_instance_id)
    if not any(r.closing_at and r.closing_at <= time.time() for r in rooms):
        return False
    assignments = db.query(BreakoutAssignment).filter_by(parent_id=parent_id, instance_id=live.meeting_instance_id).all()
    ids = []
    for assignment in assignments:
        grant = mv._grant(db, parent_id, live.meeting_instance_id, assignment.guest_id)
        if assignment.room_id != "main" and grant and grant.status == "approved":
            ids.append(assignment.guest_id)
    if ids:
        await move(db, parent_id, live, ids, "main")
    for target in rooms:
        target.closed = True
        db.query(LiveSession).filter_by(presentation_id=target.presentation_id).first().is_live = False
        await sm.sio.emit("breakout_closed", {"parentId": parent_id}, room=target.presentation_id)
    db.commit()
    await sm.sio.emit("breakout_directory_changed", {}, room="breakout-directory:" + parent_id)
    return True


async def closure_timer(parent_id, instance_id):
    await asyncio.sleep(30)
    try:
        async with room_lock(parent_id):
            with SessionLocal() as db:
                _, live, _ = context(db, parent_id)
                if live.meeting_instance_id == instance_id:
                    await finish_closure(db, parent_id, live)
    except Exception:
        # The persisted deadline is reconciled by the next authenticated room poll.
        return


@sm.sio.event
async def breakout_rooms(sid, data):
    if not isinstance(data, dict):
        return {"ok": False, "error": "Invalid room request"}
    try:
        with SessionLocal() as db:
            parent_id, _, _, _, _ = authorize(db, data)
        async with room_lock(parent_id):
            return await _room_operation(sid, data)
    except HTTPException as exc:
        return {"ok": False, "error": exc.detail}


async def _room_operation(sid, data):
    try:
        with SessionLocal() as db:
            parent_id, live, child, manager, guest = authorize(db, data)
            await finish_closure(db, parent_id, live)
            action = data.get("action", "list")
            if action != "list" and not manager and action != "return":
                raise HTTPException(403, "Host or co-host permission required")
            await sm.sio.enter_room(sid, "breakout-directory:" + parent_id)
            if action == "create":
                if any(r.closing_at for r in rooms_for(db, parent_id, live.meeting_instance_id)):
                    raise HTTPException(409, "Wait for the room closing countdown to finish")
                name = str(data.get("name") or "").strip()[:80]
                if not name or len(rooms_for(db, parent_id, live.meeting_instance_id)) >= 20:
                    raise HTTPException(422, "Enter a room name; at most 20 rooms are allowed")
                if any(r.name.casefold() == name.casefold() for r in rooms_for(db, parent_id, live.meeting_instance_id)):
                    raise HTTPException(409, "A room with this name already exists")
                presentation = Presentation(id=new_id("pres"), owner_id=db.get(Presentation, parent_id).owner_id, title=name, status="breakout")
                db.add(presentation)
                db.flush()
                slide = Slide(id=new_id("slide"), presentation_id=presentation.id, order=1, title=name, canvas={"background": "#ffffff", "elements": []})
                db.add(slide)
                db.flush()
                db.add(LiveSession(id=new_id("live"), presentation_id=presentation.id, meeting_instance_id=new_id("meeting"), is_live=True, active_slide_id=slide.id))
                db.add(BreakoutRoom(id=new_id("breakout"), parent_id=parent_id, instance_id=live.meeting_instance_id, presentation_id=presentation.id, name=name))
                db.commit()
            elif action in {"rename", "delete", "return-policy"}:
                target = db.get(BreakoutRoom, data.get("roomId"))
                if not target or target.parent_id != parent_id or target.instance_id != live.meeting_instance_id or target.closed:
                    raise HTTPException(404, "Room not found")
                if action == "rename":
                    name = str(data.get("name") or "").strip()[:80]
                    if not name:
                        raise HTTPException(422, "Enter a room name")
                    if any(r.id != target.id and r.name.casefold() == name.casefold() for r in rooms_for(db, parent_id, live.meeting_instance_id)):
                        raise HTTPException(409, "A room with this name already exists")
                    target.name = name
                    db.get(Presentation, target.presentation_id).title = name
                elif action == "return-policy":
                    target.allow_return = data.get("allowReturn") is True
                else:
                    if db.query(BreakoutAssignment).filter_by(parent_id=parent_id, instance_id=live.meeting_instance_id, room_id=target.id).first() or sm.controller_sids.get(target.presentation_id):
                        raise HTTPException(409, "Return participants and hosts before deleting this room")
                    target.closed = True
                    db.query(LiveSession).filter_by(presentation_id=target.presentation_id).first().is_live = False
                db.commit()
            elif action == "move":
                ids = data.get("guestIds")
                if not isinstance(ids, list) or not 1 <= len(ids) <= 100 or any(not isinstance(i, str) for i in ids):
                    raise HTTPException(422, "Select 1 to 100 participants")
                await move(db, parent_id, live, list(dict.fromkeys(ids)), data.get("roomId"))
            elif action == "auto-assign":
                rooms = rooms_for(db, parent_id, live.meeting_instance_id)
                if not rooms:
                    raise HTTPException(422, "Create breakout rooms first")
                guests = db.query(MeetingParticipantGrant).filter_by(presentation_id=parent_id, meeting_instance_id=live.meeting_instance_id, status="approved", role="audience").order_by(MeetingParticipantGrant.guest_id).all()
                for index, room in enumerate(rooms):
                    ids = [g.guest_id for i, g in enumerate(guests) if i % len(rooms) == index]
                    if ids:
                        await move(db, parent_id, live, ids, room.id)
            elif action == "close-all":
                deadline = time.time() + 30
                for target in rooms_for(db, parent_id, live.meeting_instance_id):
                    target.closing_at = target.closing_at or deadline
                    await sm.sio.emit("breakout_announcement", {"text": "Breakout rooms close in 30 seconds. You will return to the main room."}, room=target.presentation_id)
                db.commit()
                asyncio.create_task(closure_timer(parent_id, live.meeting_instance_id))
            elif action == "return":
                if not guest or not child or not child.allow_return:
                    raise HTTPException(403, "The host has disabled return to the main room")
                await move(db, parent_id, live, [guest.guest_id], "main")
            elif action == "visit":
                target_id = data.get("roomId")
                target = next((r for r in snapshot(db, parent_id, live, True)["rooms"] if r["id"] == target_id), None)
                if not target:
                    raise HTTPException(404, "Room not found")
                if data.get("shareToken"):
                    # A co-host keeps only their meeting-scoped role, never owner credentials.
                    share = mv.ShareLink
                    current = db.query(share).filter_by(token=data["shareToken"]).first()
                    grant = db.query(MeetingParticipantGrant).filter_by(cohost_share_id=current.id).first() if current else None
                    if not grant:
                        raise HTTPException(403, "A session-scoped co-host is required")
                    await move(db, parent_id, live, [grant.guest_id], target_id)
                    url = transfer_url(db, parent_id, live, grant.guest_id, target["presentationId"])
                    db.commit()
                else:
                    url = "/controller.html?" + urlencode({"id": target["presentationId"], "breakoutJoin": "1"})
                return {"ok": True, "url": url}
            elif action == "announce":
                text = str(data.get("text") or "").strip()[:500]
                if not text:
                    raise HTTPException(422, "Enter an announcement")
                for pid in [parent_id, *[r.presentation_id for r in rooms_for(db, parent_id, live.meeting_instance_id)]]:
                    await sm.sio.emit("breakout_announcement", {"text": text}, room=pid)
            elif action != "list":
                raise HTTPException(422, "Unknown room action")
            result = snapshot(db, parent_id, live, manager)
            if guest:
                result["returnUrl"] = transfer_url(db, parent_id, live, guest.guest_id, parent_id)
                destination = assigned_presentation(db, parent_id, live.meeting_instance_id, guest.guest_id)
                if destination != data["presentationId"]:
                    result["url"] = transfer_url(db, parent_id, live, guest.guest_id, destination)
                    db.commit()
                db.commit()
            if action != "list":
                await sm.sio.emit("breakout_directory_changed", {}, room="breakout-directory:" + parent_id)
            return {"ok": True, **result}
    except HTTPException as exc:
        return {"ok": False, "error": exc.detail}
    except Exception:
        logger.exception("Breakout room operation failed")
        return {"ok": False, "error": "Room operation failed. Please retry; no transfer should be assumed."}
