"""Consent-bound remote assistance. One ASGI worker, no input persistence.

The existing Socket.IO connection proves participant presence. Separate capabilities
scope browser and helper actions; helper approval is never a browser action.
"""
from __future__ import annotations
import asyncio
import hashlib
import json
import logging
import os
import secrets
import time
from dataclasses import dataclass, field
from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from . import socket_manager as sm
from .database import SessionLocal
from .models import LiveSession, Presentation, RemoteControlAudit, User
from .security import new_id, user_from_token

router = APIRouter(prefix='/api/remote-control', tags=['remote-control'])
ENABLED = os.getenv('REMOTE_CONTROL_ENABLED', 'false').lower() == 'true'
LEASE = 2.0
TTL = 600
bindings = {}
sessions = {}
lock = asyncio.Lock()
pair_attempts = {}
logger = logging.getLogger(__name__)

def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()

def fail(code=403, detail='Remote control authorization required'):
    raise HTTPException(code, detail)

def enabled():
    if not ENABLED:
        fail(404, 'Remote assistance is disabled')

@dataclass
class Binding:
    sid: str
    presentation: str
    role: str
    subject: str
    name: str
    instance: str
    seen: float = field(default_factory=time.monotonic)
    sharing: bool = False
    attempts: list = field(default_factory=list)

@dataclass
class Control:
    id: str
    owner: Binding
    guest: Binding
    state: str = 'requested'
    expires: float = field(default_factory=lambda: time.monotonic() + 120)
    pair_hash: str = ''
    helper_hash: str = ''
    helper: object = None
    helper_seen: float = 0
    seq: int = 0
    window: float = 0
    count: int = 0
    last_frame: float = 0
    input_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    stop_detail: str = ''


def audit(c, event):
    # Fail closed if audit persistence fails; never log tokens or input packets.
    with SessionLocal() as db:
        db.add(RemoteControlAudit(id=new_id('rcaudit'), session_id=c.id,
            presentation_id=c.owner.presentation, controller_id=c.owner.subject,
            guest_id=c.guest.subject, event=event))
        db.commit()


def present(b):
    if time.monotonic() - b.seen > LEASE:
        return False
    if b.role == 'owner':
        return b.sid in sm.controller_sids.get(b.presentation, set())
    item = sm.active_participants.get(b.presentation, {}).get(b.subject, {})
    return item.get('sid') == b.sid and b.sharing


def invalid_reason(c):
    if c.state not in {'requested', 'pairing', 'paired', 'active'}:
        return 'session_not_active'
    if time.monotonic() >= c.expires:
        return 'session_expired'
    if not present(c.owner):
        return 'owner_heartbeat_expired' if time.monotonic()-c.owner.seen > LEASE else 'owner_left_meeting'
    if not present(c.guest):
        if time.monotonic()-c.guest.seen > LEASE:
            return 'audience_heartbeat_expired'
        return 'audience_stopped_sharing' if not c.guest.sharing else 'audience_left_meeting'
    with SessionLocal() as db:
        live = db.query(LiveSession).filter_by(presentation_id=c.owner.presentation).first()
        p = db.get(Presentation, c.owner.presentation)
        owner = db.get(User, c.owner.subject)
        if not live or not live.is_live or live.meeting_instance_id != c.owner.instance:
            return 'meeting_ended_or_changed'
        if not p or p.owner_id != c.owner.subject or not owner or not owner.is_active:
            return 'owner_permission_changed'
    return ''

def valid(c):
    return not invalid_reason(c)


def view(c):
    return dict(id=c.id, state=c.state, ownerName=c.owner.name,
                guestName=c.guest.name, expiresIn=max(0, int(c.expires-time.monotonic())), stopDetail=c.stop_detail)

async def publish(c):
    for sid in {c.owner.sid, c.guest.sid}:
        await sm.sio.emit('remote_control_status', view(c), room=sid)

async def end(c, reason='ended', detail=''):
    if c.state in {'ended', 'denied', 'expired'}:
        return
    c.stop_detail = detail or invalid_reason(c) or 'control_released'
    logger.warning('Remote assistance stopped: session=%s reason=%s', c.id, c.stop_detail)
    c.state = reason
    c.pair_hash = c.helper_hash = ''
    if c.helper:
        try:
            await c.helper.send_json({'type': 'stop', 'reason': c.stop_detail})
            await c.helper.close()
        except Exception:
            pass
        c.helper = None
    audit(c, reason)
    await publish(c)

@sm.sio.on('remote_control_bind')
async def bind(sid, data):
    if not ENABLED:
        return {'enabled': False}
    pid = str(data.get('presentationId', ''))
    with SessionLocal() as db:
        live = db.query(LiveSession).filter_by(presentation_id=pid).first()
        p = db.get(Presentation, pid)
        user = user_from_token(db, data.get('authToken', ''))
        if not live or not live.is_live or not live.meeting_instance_id or not p:
            return {'error': 'Meeting is not live'}
        if user and p.owner_id == user.id and sid in sm.controller_sids.get(pid, set()):
            role, subject, name = 'owner', user.id, user.name
        else:
            guests = [(gid, item) for gid, item in sm.active_participants.get(pid, {}).items()
                      if item.get('sid') == sid]
            if len(guests) != 1:
                return {'error': 'Admitted meeting connection required'}
            subject, item = guests[0]
            role, name = 'guest', item.get('name', 'Guest')
        # A socket may have only one binding; reconnects require a fresh capability.
        for key, b in list(bindings.items()):
            if b.sid == sid:
                return {'error': 'Already bound'}
        if len(bindings) >= 1000:
            return {'error': 'Remote assistance capacity reached'}
        token = secrets.token_urlsafe(32)
        bindings[digest(token)] = Binding(sid, pid, role, subject, name, live.meeting_instance_id)
        return {'enabled': True, 'credential': token, 'role': role}

@sm.sio.on('remote_control_heartbeat')
async def heartbeat(sid, data):
    b = bindings.get(digest(str(data.get('credential', ''))))
    if b and b.sid == sid:
        b.seen = time.monotonic()
        b.sharing = data.get('sharing') is True
    # Housekeeping also makes guest/owner disconnection fail closed.
    for c in list(sessions.values()):
        if not valid(c):
            await end(c)
        if c.state in {'ended', 'denied', 'expired'} and time.monotonic() > c.expires + 60:
            sessions.pop(c.id, None)
    for key, binding in list(bindings.items()):
        if time.monotonic() - binding.seen > 60:
            bindings.pop(key, None)


def browser(request):
    enabled()
    token = request.headers.get('authorization', '').removeprefix('Bearer ')
    b = bindings.get(digest(token))
    if not b or not present(b):
        fail()
    return b

class Ask(BaseModel):
    targetIdentity: str = Field(min_length=1, max_length=128)

class SessionAction(BaseModel):
    sessionId: str = Field(min_length=1, max_length=64)

class Pair(BaseModel):
    ticket: str = Field(min_length=32, max_length=256)


def lookup(id):
    c = sessions.get(id)
    if not c:
        fail(404, 'Control request not found')
    return c

@router.post('/request')
async def request_control(payload: Ask, request: Request):
    b = browser(request)
    if b.role != 'owner':
        fail()
    async with lock:
        now = time.monotonic()
        b.attempts = [t for t in b.attempts if now-t < 60]
        if len(b.attempts) >= 5:
            fail(429, 'Wait before requesting control again')
        b.attempts.append(now)
        candidates = [g for g in bindings.values() if g.role == 'guest'
                      and g.presentation == b.presentation and g.instance == b.instance
                      and present(g) and sm.active_participants.get(b.presentation, {}).get(g.subject, {}).get('identity') == payload.targetIdentity]
        if len(candidates) != 1:
            fail(409, 'Guest must be connected and sharing a screen')
        guest = candidates[0]
        for old in sessions.values():
            if old.owner.sid == b.sid and valid(old):
                fail(409, 'End the current assistance session before requesting another')
            if old.guest.sid == guest.sid and valid(old):
                fail(409, 'A control request is already pending or active')
        if len(sessions) >= 1000:
            fail(429, 'Remote assistance capacity reached')
        c = Control(new_id('rc'), b, guest)
        if not valid(c):
            fail()
        audit(c, 'requested')
        sessions[c.id] = c
        await publish(c)
        return view(c)

@router.post('/ticket')
async def ticket(payload: SessionAction, request: Request):
    b = browser(request)
    async with lock:
        c = lookup(payload.sessionId)
        if c.guest is not b or c.state != 'requested' or not valid(c):
            fail()
        token = secrets.token_urlsafe(32)
        c.pair_hash = digest(token)
        c.state = 'pairing'
        audit(c, 'pairing')
        await publish(c)
        return {'sessionId': c.id, 'ticket': token}

@router.post('/pair')
async def pair(payload: Pair, request: Request):
    enabled()
    now = time.monotonic()
    host = request.client.host if request.client else 'unknown'
    for ip, attempts in list(pair_attempts.items()):
        if not attempts or now-attempts[-1] > 60:
            pair_attempts.pop(ip, None)
    attempts = [t for t in pair_attempts.get(host, []) if now-t < 60]
    if len(attempts) >= 20 or len(pair_attempts) >= 4096:
        fail(429, 'Too many pairing attempts')
    pair_attempts[host] = attempts + [now]
    async with lock:
        c = next((c for c in sessions.values() if c.pair_hash and secrets.compare_digest(c.pair_hash, digest(payload.ticket))), None)
        if not c or c.state != 'pairing' or not valid(c):
            fail(403, 'Invalid, expired or consumed pairing credential')
        c.pair_hash = ''
        token = secrets.token_urlsafe(32)
        c.helper_hash = digest(token)
        c.state = 'paired'
        audit(c, 'paired')
        await publish(c)
        return {**view(c), 'credential': token}

@router.post('/deny')
@router.post('/revoke')
async def revoke(payload: SessionAction, request: Request):
    b = browser(request)
    c = lookup(payload.sessionId)
    if b is not c.owner and b is not c.guest:
        fail()
    await end(c, 'denied' if request.url.path.endswith('/deny') and c.state != 'active' else 'ended')
    return view(c)

@router.get('/status')
async def status(sessionId: str, request: Request):
    b = browser(request)
    c = lookup(sessionId)
    if b is not c.owner and b is not c.guest:
        fail()
    if not valid(c):
        await end(c)
    return view(c)

# Approval only arrives on the authenticated helper channel, never from a guest browser.
@router.post('/approve')
async def reject_browser_approval():
    fail(403, 'Approve using the native helper')


def input_packet(data):
    kind = data.get('kind')
    if kind == 'move':
        return all(type(data.get(k)) in (int, float) and 0 <= data[k] <= 1 for k in ('x', 'y'))
    if kind == 'button':
        return data.get('button') in ('left', 'right') and type(data.get('down')) is bool
    if kind == 'wheel':
        return type(data.get('delta')) is int and abs(data['delta']) <= 1200
    if kind == 'key':
        # Explicit supported virtual-key subset; no Unicode strings or shell payloads.
        return type(data.get('vk')) is int and data['vk'] in {*range(48, 91), *range(96, 112), 8, 9, 13, 16, 17, 18, 20, 27, 32, 33, 34, 35, 36, 37, 38, 39, 40, 45, 46} and type(data.get('down')) is bool
    return False

@sm.sio.on('remote_control_input')
async def relay_input(sid, data):
    c = sessions.get(str(data.get('sessionId', '')))
    if not c or sid != c.owner.sid:
        return {'error': 'Not authorized'}
    async with c.input_lock:
        return await _relay_locked(c, data)

async def _relay_locked(c, data):
    if c.state != 'active' or not c.helper or not await asyncio.to_thread(valid, c):
        return {'error': 'Not authorized'}
    # A revocation may occur while the database check runs off the meeting loop.
    if c.state != 'active' or not c.helper:
        return {'error': 'Authorization ended'}
    if time.monotonic() - c.helper_seen > LEASE:
        await end(c)
        return {'error': 'Helper disconnected'}
    packet = data.get('input', {})
    seq = data.get('seq')
    if type(seq) is not int or seq != c.seq+1 or not isinstance(packet, dict) or not input_packet(packet):
        await end(c)
        return {'error': 'Invalid input sequence'}
    now = time.monotonic()
    if now-c.window >= 1:
        c.window, c.count = now, 0
    c.count += 1
    if c.count > 120:
        await end(c)
        return {'error': 'Input rate exceeded'}
    c.seq = seq
    try:
        await asyncio.wait_for(c.helper.send_json({'type': 'input', 'seq': seq, 'input': packet}), .25)
    except Exception:
        await end(c)
    return {'ok': True}

@router.websocket('/helper')
async def helper(ws: WebSocket):
    if not ENABLED:
        await ws.close(code=1008)
        return
    await ws.accept()
    c = None
    stop_detail = 'helper_connection_closed'
    try:
        auth = await asyncio.wait_for(ws.receive_json(), 5)
        c = lookup(str(auth.get('sessionId', '')))
        if not c.helper_hash or not secrets.compare_digest(c.helper_hash, digest(str(auth.get('credential', '')))) or c.helper or c.state != 'paired' or not valid(c):
            raise ValueError('Authorization failed')
        c.helper = ws
        c.helper_seen = time.monotonic()
        await ws.send_json({'type': 'ready', 'ownerName': c.owner.name, 'guestName': c.guest.name})
        while valid(c):
            # A stalled socket cannot retain an authorization lease.
            message = await asyncio.wait_for(ws.receive(), LEASE)
            if message['type'] == 'websocket.disconnect':
                stop_detail = 'helper_disconnected'
                break
            if message.get('bytes') is not None:
                image = message['bytes']
                if c.state != 'active' or len(image) > 512_000 or not image.startswith(b'\xff\xd8'):
                    stop_detail = 'invalid_preview_frame'
                    break
                now = time.monotonic()
                if now-c.last_frame < .15:
                    stop_detail = 'preview_rate_exceeded'
                    break
                c.last_frame = now
                await sm.sio.emit('remote_control_frame', {'sessionId': c.id, 'jpeg': image}, room=c.owner.sid)
                continue
            raw = message.get('text', '')
            if len(raw) > 2048:
                break
            data = json.loads(raw)
            if data.get('type') == 'approve' and c.state == 'paired':
                c.state = 'active'
                c.expires = time.monotonic()+TTL
                audit(c, 'approved')
                await publish(c)
            elif data.get('type') == 'stop':
                stop_detail = 'helper_requested_stop'
                break
            elif data.get('type') != 'heartbeat':
                break
            c.helper_seen = time.monotonic()
            await ws.send_json({'type': 'lease', 'active': c.state == 'active', 'seq': c.seq, 'leaseMs': 1000})
    except (WebSocketDisconnect, asyncio.TimeoutError, ValueError, HTTPException, RuntimeError) as error:
        stop_detail = 'helper_' + type(error).__name__
    finally:
        if c and c.helper is ws:
            await end(c, detail=invalid_reason(c) or stop_detail)
        try:
            await ws.close()
        except Exception:
            pass


_original_disconnect = sm.sio.handlers['/']['disconnect']
@sm.sio.on('disconnect')
async def disconnected(sid):
    try:
        return await _original_disconnect(sid)
    finally:
        for c in list(sessions.values()):
            if sid in {c.owner.sid, c.guest.sid}:
                await end(c)
        for key, b in list(bindings.items()):
            if b.sid == sid:
                bindings.pop(key, None)

@router.get('/download')
async def download(request: Request):
    from pathlib import Path
    from fastapi.responses import FileResponse
    b = browser(request)
    if b.role != 'guest':
        fail()
    path = Path(os.getenv('REMOTE_ASSIST_SIGNED_EXE', '/nonexistent/remote-assist.exe'))
    expected = os.getenv('REMOTE_ASSIST_SHA256', '')
    if not path.is_file() or len(expected) != 64 or digest_bytes(path.read_bytes()) != expected.lower():
        fail(503, 'Signed Windows helper is not published yet')
    return FileResponse(path, media_type='application/octet-stream', filename='SnapKeyRemoteAssist.exe', headers={'Cache-Control': 'no-store'})

def digest_bytes(value):
    return hashlib.sha256(value).hexdigest()
