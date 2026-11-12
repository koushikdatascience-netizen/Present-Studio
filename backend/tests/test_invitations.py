from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock
import hashlib, hmac, json
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app import invitations as inv
from app.database import Base, get_db
from app.models import User, Meeting, InvitationDelivery
from app.security import current_user

@pytest.fixture
def setup(monkeypatch):
    engine=create_engine('sqlite://',connect_args={'check_same_thread':False},poolclass=StaticPool)
    Base.metadata.create_all(engine); sessions=sessionmaker(bind=engine)
    with sessions() as db:
        db.add(User(id='owner',name='Host',email='host@test.local',password_hash='unused'))
        db.add(Meeting(id='meeting',owner_id='owner',presentation_id='p',audience_share_id='s',scheduled_start=datetime.now(timezone.utc)))
        db.commit()
    monkeypatch.setattr(inv,'SessionLocal',sessions)
    app=FastAPI(); app.include_router(inv.router)
    def database():
        with sessions() as db: yield db
    app.dependency_overrides[get_db]=database
    app.dependency_overrides[current_user]=lambda:SimpleNamespace(id='owner')
    for key,value in {'SMTP_HOST':'smtp.test','SMTP_USERNAME':'test','SMTP_PASSWORD':'secret','SMTP_FROM_EMAIL':'sender@test.local','SMTP_PORT':'587','SMTP_SSL':'false','SMTP_STARTTLS':'true','META_APP_SECRET':'secret','WHATSAPP_BUSINESS_ACCOUNT_ID':'123','WHATSAPP_PHONE_NUMBER_ID':'456','WHATSAPP_ACCESS_TOKEN':'token','WHATSAPP_API_VERSION':'v25.0','WHATSAPP_WEBHOOK_VERIFY_TOKEN':'verify'}.items(): monkeypatch.setenv(key,value)
    with TestClient(app) as client: yield client,sessions,monkeypatch
    engine.dispose()

def message():
    return dict(requestId='request-1234567890',meetingId='meeting',channel='email',recipients=['person@example.com'],subject='Invite',body='Join',consent=True)

def test_queue_idempotency_and_recipients(setup):
    c,s,_=setup; p=message(); p['recipients']=['Person@example.com','person@example.com']
    a=c.post('/api/invitations/send',json=p); b=c.post('/api/invitations/send',json=p)
    assert a.status_code==202 and a.json()==b.json()
    with s() as db: assert db.query(InvitationDelivery).count()==1

def test_configuration_ownership_consent(setup):
    c,_,m=setup; m.delenv('SMTP_PASSWORD')
    assert c.post('/api/invitations/send',json=message()).status_code==503
    p=message(); p['meetingId']='other'
    assert c.post('/api/invitations/send',json=p).status_code==404
    m.setenv('SMTP_PASSWORD','secret'); p=message(); p['consent']=False
    assert c.post('/api/invitations/send',json=p).status_code==422

def test_email_tls_private_delivery(setup):
    c,s,m=setup; smtp=MagicMock(); m.setattr(inv.smtplib,'SMTP',smtp)
    assert c.post('/api/invitations/send',json=message()).status_code==202
    assert inv.deliver_one()
    transport=smtp.return_value.__enter__.return_value; transport.starttls.assert_called_once()
    assert transport.send_message.call_args.args[0]['To']=='person@example.com'
    with s() as db: assert db.query(InvitationDelivery).one().status=='accepted'

def test_timeout_not_retried(setup):
    c,s,m=setup; smtp=MagicMock(side_effect=TimeoutError()); m.setattr(inv.smtplib,'SMTP',smtp)
    c.post('/api/invitations/send',json=message()); inv.deliver_one()
    with s() as db:
        d=db.query(InvitationDelivery).one(); identifier=d.id; assert d.status=='unknown'
    assert c.post('/api/invitations/deliveries/'+identifier+'/retry').status_code==409

def test_meta_template_payload(setup):
    c,s,m=setup; m.setattr(inv,'approved_templates',lambda:[dict(name='invite',language='en_US',parameters=1,supported=True)])
    provider=MagicMock(return_value={'messages':[{'id':'wamid.test'}]}); m.setattr(inv,'graph',provider)
    p=message(); p.update(channel='whatsapp',recipients=['+919876543210'],templateName='invite',language='en_US',parameters=['Title'])
    assert c.post('/api/invitations/send',json=p).status_code==202
    inv.deliver_one(); assert provider.call_args.args[1]['template']['components'][0]['parameters'][0]['text']=='Title'

def test_webhook_signature_and_status_order(setup):
    c,s,_=setup; c.post('/api/invitations/send',json=message())
    with s() as db:
        d=db.query(InvitationDelivery).one(); d.provider_id='wamid.test'; d.status='read'; db.commit()
    raw=json.dumps({'entry':[{'id':'123','changes':[{'value':{'metadata':{'phone_number_id':'456'},'statuses':[{'id':'wamid.test','status':'sent'}]}}]}]}).encode()
    sig='sha256='+hmac.new(b'secret',raw,hashlib.sha256).hexdigest()
    assert c.post('/api/invitations/whatsapp/webhook',content=raw).status_code==403
    assert c.post('/api/invitations/whatsapp/webhook',content=raw,headers={'x-hub-signature-256':sig}).status_code==200
    with s() as db: assert db.query(InvitationDelivery).one().status=='read'

def test_early_webhook_is_retained_until_send_response(setup):
    c,s,m=setup
    m.setattr(inv,'approved_templates',lambda:[dict(name='invite',language='en_US',parameters=0,supported=True)])
    p=message(); p.update(channel='whatsapp',recipients=['+919876543210'],templateName='invite',language='en_US')
    assert c.post('/api/invitations/send',json=p).status_code==202
    with s() as db:
        d=db.query(InvitationDelivery).one(); d.status='sending'; db.commit()
    raw=json.dumps({'entry':[{'id':'123','changes':[{'value':{'metadata':{'phone_number_id':'456'},'statuses':[{'id':'wamid.early','status':'delivered'}]}}]}]}).encode()
    sig='sha256='+hmac.new(b'secret',raw,hashlib.sha256).hexdigest()
    assert c.post('/api/invitations/whatsapp/webhook',content=raw,headers={'x-hub-signature-256':sig}).status_code==200
    with s() as db:
        assert db.query(inv.InvitationStatusEvent).count()==1
        db.query(InvitationDelivery).one().provider_id='wamid.early'; db.commit()
    inv.deliver_one()
    with s() as db:
        assert db.query(InvitationDelivery).one().status=='delivered'
        assert db.query(inv.InvitationStatusEvent).count()==0

def test_daily_limit_and_recipient_validation(setup):
    c,s,m=setup; m.setenv('INVITATION_DAILY_LIMIT','1')
    p=message(); p['recipients']=['a@example.com','b@example.com']
    assert c.post('/api/invitations/send',json=p).status_code==429
    p['recipients']=['a@example.com\r\nBcc: b@example.com']
    assert c.post('/api/invitations/send',json=p).status_code==422
    with s() as db: assert db.query(InvitationDelivery).count()==0
