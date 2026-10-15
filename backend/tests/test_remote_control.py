import asyncio
import time
from unittest.mock import AsyncMock
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app import remote_control as rc
from app.database import Base
from app.models import User, Presentation, LiveSession, RemoteControlAudit
from app.security import create_access_token

@pytest.fixture
def setup(monkeypatch):
    engine = create_engine('sqlite://', connect_args={'check_same_thread':False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    monkeypatch.setattr(rc, 'SessionLocal', factory)
    monkeypatch.setattr(rc, 'ENABLED', True)
    monkeypatch.setattr(rc.sm.sio, 'emit', AsyncMock())
    monkeypatch.setattr(rc.sm, 'controller_sids', {'p': {'owner-sid', 'attacker-sid'}})
    monkeypatch.setattr(rc.sm, 'active_participants', {'p': {'guest': {'sid':'guest-sid','identity':'viewer-guest','name':'Guest'}}})
    rc.bindings.clear(); rc.sessions.clear(); rc.pair_attempts.clear()
    with factory() as db:
        owner = User(id='owner', name='Owner', email='owner@example.com', password_hash='unused', role='owner', is_active=True)
        attacker = User(id='attacker', name='Attacker', email='attacker@example.com', password_hash='unused', role='owner', is_active=True)
        db.add_all([owner,attacker]);db.flush()
        tokens = {u.id:create_access_token(u) for u in [owner,attacker]}
        db.add(Presentation(id='p', title='Meeting', owner_id='owner'));db.flush()
        db.add(LiveSession(id='live',presentation_id='p',meeting_instance_id='instance',is_live=True));db.commit()
    owner = asyncio.run(rc.bind('owner-sid', {'presentationId':'p','authToken':tokens['owner']}))
    guest = asyncio.run(rc.bind('guest-sid', {'presentationId':'p'}))
    rc.bindings[rc.digest(guest['credential'])].sharing = True
    app = FastAPI();app.include_router(rc.router)
    with TestClient(app) as client:
        yield client, {'Authorization':'Bearer '+owner['credential']}, {'Authorization':'Bearer '+guest['credential']}, factory, tokens
    rc.bindings.clear();rc.sessions.clear();engine.dispose()

def ask(setup):
    client,owner,guest,*_ = setup
    response = client.post('/api/remote-control/request',headers=owner,json={'targetIdentity':'viewer-guest'})
    assert response.status_code == 200, response.text
    return response.json()['id']

def paired(setup):
    client,owner,guest,*_ = setup
    id=ask(setup)
    r=client.post('/api/remote-control/ticket',headers=guest,json={'sessionId':id});assert r.status_code==200
    ticket=r.json()['ticket']
    r=client.post('/api/remote-control/pair',json={'ticket':ticket});assert r.status_code==200
    return id,r.json()['credential'],ticket

def test_valid_owner_and_no_secrets_in_audit(setup):
    id=ask(setup)
    with setup[3]() as db:
        rows=db.query(RemoteControlAudit).all()
        assert len(rows)==1 and rows[0].event=='requested'
        assert 'credential' not in rows[0].__table__.columns

def test_guest_cannot_request(setup):
    c,_,guest,*_=setup
    assert c.post('/api/remote-control/request',headers=guest,json={'targetIdentity':'viewer-guest'}).status_code==403

def test_unrelated_participant_cannot_bind_as_owner(setup):
    result=asyncio.run(rc.bind('attacker-sid',{'presentationId':'p','authToken':setup[4]['attacker']}))
    assert 'credential' not in result

def test_unadmitted_guest_rejected(setup):
    assert 'credential' not in asyncio.run(rc.bind('unknown',{'presentationId':'p'}))

def test_browser_cannot_approve(setup):
    id=ask(setup)
    assert setup[0].post('/api/remote-control/approve',headers=setup[2],json={'sessionId':id}).status_code==403
    assert rc.sessions[id].state=='requested'

def test_guest_denial(setup):
    id=ask(setup)
    r=setup[0].post('/api/remote-control/deny',headers=setup[2],json={'sessionId':id})
    assert r.json()['state']=='denied'

def test_pairing_is_single_use(setup):
    id,credential,ticket=paired(setup)
    assert setup[0].post('/api/remote-control/pair',json={'ticket':ticket}).status_code==403
    assert rc.digest(credential)==rc.sessions[id].helper_hash

def test_expired_ticket(setup):
    id=ask(setup)
    ticket=setup[0].post('/api/remote-control/ticket',headers=setup[2],json={'sessionId':id}).json()['ticket']
    rc.sessions[id].expires=time.monotonic()-1
    assert setup[0].post('/api/remote-control/pair',json={'ticket':ticket}).status_code==403

def test_owner_cannot_mint_guest_ticket(setup):
    id=ask(setup)
    assert setup[0].post('/api/remote-control/ticket',headers=setup[1],json={'sessionId':id}).status_code==403

def test_simultaneous_requests_exclusive(setup):
    ask(setup)
    assert setup[0].post('/api/remote-control/request',headers=setup[1],json={'targetIdentity':'viewer-guest'}).status_code==409

def test_cross_meeting_guest_rejected(setup):
    next(b for b in rc.bindings.values() if b.role=='guest').instance='other-meeting'
    assert setup[0].post('/api/remote-control/request',headers=setup[1],json={'targetIdentity':'viewer-guest'}).status_code==409

def test_input_before_consent_blocked(setup):
    id=ask(setup)
    result=asyncio.run(rc.relay_input('owner-sid',{'sessionId':id,'seq':1,'input':{'kind':'key','vk':65,'down':True}}))
    assert result.get('error')

def test_native_approval_and_termination(setup):
    id,credential,_=paired(setup)
    with setup[0].websocket_connect('/api/remote-control/helper') as ws:
        ws.send_json({'sessionId':id,'credential':credential})
        assert ws.receive_json()['type']=='ready'
        ws.send_json({'type':'approve'})
        assert ws.receive_json()['active'] is True
        assert rc.sessions[id].state=='active'
        ws.send_json({'type':'stop'})
    assert rc.sessions[id].state=='ended'

@pytest.mark.parametrize('role',['owner','guest'])
def test_browser_disconnect_revokes(setup,role):
    id=ask(setup)
    binding=rc.sessions[id].owner if role=='owner' else rc.sessions[id].guest
    binding.seen-=3
    assert not rc.valid(rc.sessions[id])
    assert asyncio.run(rc.relay_input('owner-sid',{'sessionId':id,'seq':1,'input':{'kind':'move','x':.2,'y':.3}})).get('error')

def test_native_connection_loss_revokes(setup):
    id,credential,_=paired(setup)
    with setup[0].websocket_connect('/api/remote-control/helper') as ws:
        ws.send_json({'sessionId':id,'credential':credential});ws.receive_json()
        ws.send_json({'type':'approve'});ws.receive_json()
    # TestClient returns from its socket context before ASGI disconnect cleanup
    # necessarily runs. Assert prompt eventual revocation on the server loop.
    async def wait_for_revocation():
        for _ in range(100):
            if rc.sessions[id].state == 'ended':
                return
            await asyncio.sleep(.01)
        raise AssertionError('Helper disconnect did not revoke within one second')
    setup[0].portal.call(wait_for_revocation)
    assert rc.sessions[id].state=='ended'

def test_revoke_blocks_pair_and_input(setup):
    id,credential,ticket=paired(setup)
    assert setup[0].post('/api/remote-control/revoke',headers=setup[1],json={'sessionId':id}).json()['state']=='ended'
    assert setup[0].post('/api/remote-control/pair',json={'ticket':ticket}).status_code==403
    assert asyncio.run(rc.relay_input('owner-sid',{'sessionId':id})).get('error')

def test_input_sequence_and_wrong_controller(setup):
    id,_,_=paired(setup);session=rc.sessions[id]
    session.state='active';session.helper=AsyncMock();session.helper_seen=time.monotonic()
    packet={'sessionId':id,'seq':1,'input':{'kind':'key','vk':65,'down':True}}
    assert asyncio.run(rc.relay_input('guest-sid',packet)).get('error')
    assert asyncio.run(rc.relay_input('owner-sid',packet))=={'ok':True}
    assert asyncio.run(rc.relay_input('owner-sid',packet)).get('error')
    assert session.state=='ended'

def test_untrusted_helper_cannot_terminate_legitimate_helper(setup):
    id,_,_=paired(setup)
    existing=AsyncMock();rc.sessions[id].helper=existing
    with setup[0].websocket_connect('/api/remote-control/helper') as ws:
        ws.send_json({'sessionId':id,'credential':'forged'})
        with pytest.raises(Exception):ws.receive_json()
    assert rc.sessions[id].helper is existing

def test_helper_download_unavailable_until_signed_release(setup):
    assert setup[0].get('/api/remote-control/download',headers=setup[2]).status_code==503

@pytest.mark.parametrize('p',[{'kind':'shell','command':'whoami'},{'kind':'move','x':-1,'y':0},{'kind':'move','x':float('nan'),'y':0},{'kind':'key','vk':91,'down':True},{'kind':'key','vk':65,'down':'yes'},{'kind':'wheel','delta':2000}])
def test_invalid_inputs(p):assert not rc.input_packet(p)

def test_feature_disabled(setup,monkeypatch):
    monkeypatch.setattr(rc,'ENABLED',False)
    assert setup[0].post('/api/remote-control/request',headers=setup[1],json={'targetIdentity':'viewer-guest'}).status_code==404


def test_pair_rate_limit(setup):
    c=setup[0]
    for _ in range(20):
        assert c.post('/api/remote-control/pair',json={'ticket':'x'*43}).status_code==403
    assert c.post('/api/remote-control/pair',json={'ticket':'x'*43}).status_code==429

def test_stopping_screen_share_invalidates_control(setup):
    id=ask(setup)
    rc.sessions[id].guest.sharing=False
    assert not rc.valid(rc.sessions[id])

def test_meeting_end_invalidates_control(setup):
    id=ask(setup)
    with setup[3]() as db:
        db.query(LiveSession).update({'is_live':False});db.commit()
    assert not rc.valid(rc.sessions[id])

def test_owner_permission_revoked(setup):
    id=ask(setup)
    with setup[3]() as db:
        db.query(User).filter_by(id='owner').update({'is_active':False});db.commit()
    assert not rc.valid(rc.sessions[id])


def test_concurrent_events_preserve_sequence(setup):
    id,_,_=paired(setup);session=rc.sessions[id]
    session.state='active';session.helper=AsyncMock();session.helper_seen=time.monotonic()
    async def run():
        return await asyncio.gather(*[rc.relay_input('owner-sid',{'sessionId':id,'seq':i,'input':{'kind':'move','x':.5,'y':.5}}) for i in range(1,11)])
    assert all(r=={'ok':True} for r in asyncio.run(run()))
    assert session.seq==10 and session.state=='active'


def test_controller_cannot_abandon_active_session_for_another_guest(setup):
    ask(setup)
    rc.sm.active_participants['p']['second']={'sid':'second-sid','identity':'viewer-second','name':'Second'}
    result=asyncio.run(rc.bind('second-sid',{'presentationId':'p'}))
    rc.bindings[rc.digest(result['credential'])].sharing=True
    response=setup[0].post('/api/remote-control/request',headers=setup[1],json={'targetIdentity':'viewer-second'})
    assert response.status_code==409
    assert len(rc.sessions)==1
