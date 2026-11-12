"""Persistent invitation outbox. No credentials or provider responses reach browsers."""
import asyncio
import hashlib
import hmac
import json
import os
import re
import smtplib
import ssl
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from email.utils import formataddr
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, update
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from .database import SessionLocal, get_db
from .models import InvitationBatch, InvitationDelivery, InvitationStatusEvent, Meeting, User
from .security import current_user, new_id

router = APIRouter(prefix='/api/invitations', tags=['invitations'])
worker_task = None

def configured(channel):
    keys = ['SMTP_HOST', 'SMTP_USERNAME', 'SMTP_PASSWORD', 'SMTP_FROM_EMAIL'] if channel == 'email' else ['WHATSAPP_BUSINESS_ACCOUNT_ID', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_API_VERSION', 'META_APP_SECRET', 'WHATSAPP_WEBHOOK_VERIFY_TOKEN']
    return all(os.getenv(key, '').strip() for key in keys)

@router.get('/configuration')
def configuration(user: User = Depends(current_user)):
    return {'email': configured('email'), 'whatsapp': configured('whatsapp')}

def graph(path, payload=None):
    version = os.getenv('WHATSAPP_API_VERSION', '')
    if not re.fullmatch(r'v\d+\.\d+', version):
        raise ValueError('Set WHATSAPP_API_VERSION to a supported Meta Graph API version')
    req = urllib.request.Request('https://graph.facebook.com/' + version + '/' + path,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={'Authorization': 'Bearer ' + os.environ['WHATSAPP_ACCESS_TOKEN'], 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=20) as response:
        return json.load(response)

def approved_templates():
    account = os.environ['WHATSAPP_BUSINESS_ACCOUNT_ID']
    if not account.isdigit(): raise ValueError('Invalid business account ID')
    results = []
    after = ''
    for _ in range(10):
        page = graph(account + '/message_templates?limit=100' + ('&after=' + urllib.parse.quote(after) if after else ''))
        for item in page.get('data', []):
            if item.get('status') != 'APPROVED': continue
            # Text body templates with optional static text header/footer/buttons.
            # Dynamic media/header/button templates are not represented as a plain-text invite.
            components = item.get('components', [])
            supported = item.get('parameter_format', 'POSITIONAL') == 'POSITIONAL'
            for component in components:
                kind = component.get('type')
                if kind == 'HEADER' and (component.get('format') != 'TEXT' or '{{' in component.get('text', '')): supported = False
                if kind == 'BUTTONS' and any('{{' in json.dumps(button) or button.get('type') not in {'URL', 'PHONE_NUMBER', 'QUICK_REPLY'} for button in component.get('buttons', [])): supported = False
            body = next((c.get('text', '') for c in components if c.get('type') == 'BODY'), '')
            slots = sorted(set(int(x) for x in re.findall(r'\{\{(\d+)\}\}', body)))
            if slots != list(range(1, len(slots) + 1)): supported = False
            results.append({'name': item['name'], 'language': item['language'], 'body': body, 'parameters': len(slots), 'supported': supported})
        after = page.get('paging', {}).get('cursors', {}).get('after', '') if page.get('paging', {}).get('next') else ''
        if not after: break
    return results

@router.get('/whatsapp-templates')
def templates(user: User = Depends(current_user)):
    if not configured('whatsapp'): raise HTTPException(503, 'WhatsApp sending is not configured. Ask your administrator to add the environment settings.')
    try: return {'templates': approved_templates()}
    except Exception: raise HTTPException(502, 'Could not load approved Meta templates. Check the API account configuration.')

class MetaTemplateCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100, pattern=r'^[a-z0-9_]+$')
    language: str = Field(min_length=2, max_length=16, pattern=r'^[a-z]{2,3}(?:_[A-Z]{2})?$')
    category: str = Field(pattern=r'^(UTILITY|MARKETING)$')
    body: str = Field(min_length=1, max_length=1024)
    examples: list[str] = Field(default_factory=list, max_length=30)

@router.post('/whatsapp-templates', status_code=201)
def create_meta_template(payload: MetaTemplateCreate, user: User = Depends(current_user)):
    if not configured('whatsapp'): raise HTTPException(503, 'WhatsApp sending is not configured')
    slots = sorted(set(int(x) for x in re.findall(r'\{\{(\d+)\}\}', payload.body)))
    if slots != list(range(1, len(slots) + 1)) or len(slots) != len(payload.examples) or any(not x.strip() or len(x) > 1000 for x in payload.examples): raise HTTPException(422, 'Use consecutive numbered variables and supply one example per variable')
    component = {'type': 'BODY', 'text': payload.body}
    if payload.examples: component['example'] = {'body_text': [payload.examples]}
    account = os.getenv('WHATSAPP_BUSINESS_ACCOUNT_ID', '')
    if not account.isdigit(): raise HTTPException(503, 'Invalid WhatsApp account configuration')
    try: graph(account + '/message_templates', {'name': payload.name, 'language': payload.language, 'category': payload.category, 'components': [component]})
    except Exception: raise HTTPException(502, 'Meta could not accept the template. Check its name, language, category and example values.')
    return {'status': 'submitted', 'message': 'Submitted to Meta. It will appear in the template list after approval.'}

class SendInvitation(BaseModel):
    requestId: str = Field(min_length=16, max_length=80, pattern=r'^[a-zA-Z0-9_-]+$')
    meetingId: str = Field(max_length=64)
    channel: str = Field(pattern=r'^(email|whatsapp)$')
    recipients: list[str] = Field(min_length=1, max_length=100)
    subject: str = Field(default='', max_length=250)
    body: str = Field(default='', max_length=10000)
    templateName: str = Field(default='', max_length=512)
    language: str = Field(default='', max_length=32)
    parameters: list[str] = Field(default_factory=list, max_length=30)
    consent: bool = False

def clean_recipients(values, channel):
    result = []
    for raw in values:
        value = raw.strip()
        if channel == 'email':
            if not re.fullmatch(r'[^\s@,;<>\r\n]+@[^\s@,;<>\r\n]+\.[^\s@,;<>\r\n]+', value) or len(value) > 254: raise HTTPException(422, 'Enter valid email addresses')
            value = value.lower()
        else:
            value = re.sub(r'[\s().-]', '', value).lstrip('+')
            if not re.fullmatch(r'[1-9]\d{7,14}', value): raise HTTPException(422, 'Use valid WhatsApp numbers including country codes')
        if value not in result: result.append(value)
    return result

@router.post('/send', status_code=202)
def enqueue(payload: SendInvitation, user: User = Depends(current_user), db: Session = Depends(get_db)):
    meeting = db.get(Meeting, payload.meetingId)
    if not meeting or meeting.owner_id != user.id: raise HTTPException(404, 'Meeting not found')
    batch_id = 'invite_' + hashlib.sha256((user.id + ':' + payload.requestId).encode()).hexdigest()[:48]
    existing = db.get(InvitationBatch, batch_id)
    if existing:
        if existing.meeting_id != meeting.id or existing.channel != payload.channel: raise HTTPException(409, 'Request ID was already used for another invitation')
        return {'batchId': batch_id}
    if not configured(payload.channel): raise HTTPException(503, f'{payload.channel.title()} sending is not configured. Ask your administrator to add the environment settings.')
    recipients = clean_recipients(payload.recipients, payload.channel)
    if not payload.consent: raise HTTPException(422, 'Confirm that the recipients agreed to receive these invitations')
    if '\n' in payload.subject or '\r' in payload.subject: raise HTTPException(422, 'Email subject must be a single line')
    if payload.channel == 'email' and not payload.body.strip(): raise HTTPException(422, 'Message is empty')
    if any(not x.strip() or len(x) > 1000 for x in payload.parameters): raise HTTPException(422, 'Fill all template variables (maximum 1000 characters each)')
    if payload.channel == 'whatsapp':
        try: available = approved_templates()
        except Exception: raise HTTPException(502, 'Could not verify the approved Meta template')
        template = next((t for t in available if t['name'] == payload.templateName and t['language'] == payload.language), None)
        if not template or not template['supported'] or template['parameters'] != len(payload.parameters): raise HTTPException(422, 'Choose an approved supported text template and fill all its variables')
    since = datetime.now(timezone.utc) - timedelta(days=1)
    db.query(User).filter_by(id=user.id).with_for_update().first()
    total = db.query(func.count(InvitationDelivery.id)).join(InvitationBatch).filter(InvitationBatch.owner_id == user.id, InvitationBatch.created_at >= since).scalar() or 0
    if total + len(recipients) > int(os.getenv('INVITATION_DAILY_LIMIT', '500')): raise HTTPException(429, 'Daily invitation limit reached')
    db.add(InvitationBatch(id=batch_id, owner_id=user.id, meeting_id=meeting.id, channel=payload.channel, payload=payload.model_dump(exclude={'recipients', 'requestId'})))
    try:
        db.flush()
        for recipient in recipients: db.add(InvitationDelivery(id=new_id('delivery'), batch_id=batch_id, recipient=recipient, status='queued'))
        db.commit()
    except IntegrityError:
        db.rollback()
        if not db.get(InvitationBatch, batch_id): raise
    return {'batchId': batch_id}

@router.get('/history')
def history(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.query(InvitationBatch).filter_by(owner_id=user.id).order_by(InvitationBatch.created_at.desc()).limit(20).all()
    return {'batches': [{'id': batch.id, 'channel': batch.channel, 'meetingId': batch.meeting_id, 'deliveries': [{'id': d.id, 'recipient': d.recipient, 'status': d.status, 'error': d.error} for d in db.query(InvitationDelivery).filter_by(batch_id=batch.id).all()]} for batch in rows]}

@router.post('/deliveries/{delivery_id}/retry')
def retry(delivery_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    delivery = db.get(InvitationDelivery, delivery_id)
    batch = db.get(InvitationBatch, delivery.batch_id) if delivery else None
    if not batch or batch.owner_id != user.id: raise HTTPException(404, 'Delivery not found')
    if delivery.status != 'failed': raise HTTPException(409, 'Only confirmed failed messages can be retried; uncertain deliveries must be checked first')
    if not configured(batch.channel): raise HTTPException(503, 'Sending is not configured')
    changed = db.execute(update(InvitationDelivery).where(InvitationDelivery.id == delivery.id, InvitationDelivery.status == 'failed').values(status='queued', error='')).rowcount
    db.commit()
    if not changed: raise HTTPException(409, 'This delivery is already being retried')
    return {'ok': True}

def reconcile_status_events(db):
    rank = {'accepted': 0, 'sent': 1, 'delivered': 2, 'read': 3}
    expired = datetime.now(timezone.utc) - timedelta(days=7)
    db.query(InvitationStatusEvent).filter(InvitationStatusEvent.created_at < expired).delete()
    for event in db.query(InvitationStatusEvent).order_by(InvitationStatusEvent.created_at).limit(100).all():
        delivery = db.query(InvitationDelivery).filter_by(provider_id=event.provider_id).first()
        if not delivery: continue
        if event.status in rank and rank[event.status] > rank.get(delivery.status, -1):
            delivery.status = event.status; delivery.error = ''
        elif event.status == 'failed' and delivery.status not in {'delivered', 'read'}:
            delivery.status = 'failed'; delivery.error = 'WhatsApp reported delivery failure. Check recipient and Meta account.'
        db.delete(event)


def deliver_one():
    with SessionLocal() as db:
        reconcile_status_events(db)
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=5)
        db.query(InvitationDelivery).filter(InvitationDelivery.status == 'sending', InvitationDelivery.updated_at < cutoff).update({'status': 'unknown', 'error': 'Sending confirmation was interrupted. Check provider records before resending.'})
        db.commit()
        delivery = db.query(InvitationDelivery).filter_by(status='queued').order_by(InvitationDelivery.updated_at).first()
        if not delivery: return False
        changed = db.execute(update(InvitationDelivery).where(InvitationDelivery.id == delivery.id, InvitationDelivery.status == 'queued').values(status='sending')).rowcount
        db.commit()
        if not changed: return True
        batch = db.get(InvitationBatch, delivery.batch_id)
        p = batch.payload
        try:
            if batch.channel == 'email':
                message = EmailMessage()
                message['From'] = formataddr((os.getenv('SMTP_FROM_NAME', 'SnapKey Studio'), os.environ['SMTP_FROM_EMAIL']))
                message['To'] = delivery.recipient; message['Subject'] = p['subject']; message.set_content(p['body'])
                implicit_tls = os.getenv('SMTP_SSL', 'false').lower() == 'true'
                if not implicit_tls and os.getenv('SMTP_STARTTLS', 'true').lower() != 'true': raise ValueError('SMTP TLS is required')
                transport = smtplib.SMTP_SSL if implicit_tls else smtplib.SMTP
                tls_options = {'context': ssl.create_default_context()} if implicit_tls else {}
                with transport(os.environ['SMTP_HOST'], int(os.getenv('SMTP_PORT', '465' if implicit_tls else '587')), timeout=20, **tls_options) as smtp:
                    if not implicit_tls: smtp.starttls(context=ssl.create_default_context())
                    smtp.login(os.environ['SMTP_USERNAME'], os.environ['SMTP_PASSWORD'])
                    smtp.send_message(message)
                delivery.status = 'accepted'
            else:
                phone_id = os.environ['WHATSAPP_PHONE_NUMBER_ID']
                if not phone_id.isdigit(): raise ValueError('Invalid phone number ID')
                template = {'name': p['templateName'], 'language': {'code': p['language']}}
                if p['parameters']: template['components'] = [{'type': 'body', 'parameters': [{'type': 'text', 'text': value} for value in p['parameters']]}]
                response = graph(phone_id + '/messages', {'messaging_product': 'whatsapp', 'to': delivery.recipient, 'type': 'template', 'template': template})
                delivery.provider_id = response['messages'][0]['id']; delivery.status = 'accepted'
        except urllib.error.HTTPError as error:
            delivery.status = 'unknown' if error.code >= 500 else 'failed'
            delivery.error = f'Meta returned HTTP {error.code}. Check provider records before resending.'
        except json.JSONDecodeError:
            delivery.status = 'unknown'; delivery.error = 'Provider response could not be read. Check provider records before resending.'
        except (smtplib.SMTPResponseException, smtplib.SMTPRecipientsRefused, ValueError):
            delivery.status = 'failed'; delivery.error = 'Provider rejected the request or sending configuration is invalid.'
        except Exception:
            delivery.status = 'unknown'; delivery.error = 'Provider response was interrupted. Check provider records before resending to avoid duplicates.'
        db.commit()
    return True

async def worker():
    while True:
        try:
            worked = await asyncio.to_thread(deliver_one)
            await asyncio.sleep(0.5 if worked else 3)
        except asyncio.CancelledError: raise
        except Exception: await asyncio.sleep(5)

@router.get('/whatsapp/webhook')
def verify_webhook(request: Request):
    token = os.getenv('WHATSAPP_WEBHOOK_VERIFY_TOKEN', '')
    if not token or request.query_params.get('hub.mode') != 'subscribe' or not hmac.compare_digest(token, request.query_params.get('hub.verify_token', '')): raise HTTPException(403, 'Verification failed')
    return PlainTextResponse(request.query_params.get('hub.challenge', ''))

@router.post('/whatsapp/webhook')
async def webhook(request: Request, db: Session = Depends(get_db)):
    raw = bytearray()
    async for chunk in request.stream():
        raw.extend(chunk)
        if len(raw) > 1048576: raise HTTPException(413, 'Payload too large')
    secret = os.getenv('META_APP_SECRET', '')
    expected = 'sha256=' + hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    if not secret or not hmac.compare_digest(expected, request.headers.get('x-hub-signature-256', '')): raise HTTPException(403, 'Invalid signature')
    try: payload = json.loads(raw)
    except ValueError: raise HTTPException(400, 'Invalid JSON')
    rank = {'accepted': 0, 'sent': 1, 'delivered': 2, 'read': 3}
    for entry in payload.get('entry', []):
        if str(entry.get('id')) != os.getenv('WHATSAPP_BUSINESS_ACCOUNT_ID'): continue
        for change in entry.get('changes', []):
            value = change.get('value', {})
            if str(value.get('metadata', {}).get('phone_number_id')) != os.getenv('WHATSAPP_PHONE_NUMBER_ID'): continue
            for status in value.get('statuses', []):
                identifier, state = str(status.get('id', '')), status.get('status')
                if not identifier or len(identifier) > 255 or state not in {'sent', 'delivered', 'read', 'failed'}: continue
                db.add(InvitationStatusEvent(id=new_id('status'), provider_id=identifier, status=state))
    db.flush()
    reconcile_status_events(db)
    db.commit()
    return {'ok': True}
