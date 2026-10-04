import asyncio
from concurrent.futures import ThreadPoolExecutor
import pytest
from fastapi import HTTPException
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app import socket_manager
from app.main import fastapi_app
from app.whiteboard import validate_document
from app.database import SessionLocal
from app.models import LiveSession, MeetingParticipantGrant, ShareLink
from app.security import create_participant_resume_token


def test_whiteboard_requires_presenter_and_restores_live_mode():
    with TestClient(fastapi_app) as client:
        login = client.post('/api/auth/login', json={
            'email': 'owner@presentstudio.local', 'password': 'password123',
        })
        token = login.json()['accessToken']
        headers = {'Authorization': f'Bearer {token}'}
        created = client.post('/api/presentations', json={'title': 'Whiteboard regression'}, headers=headers)
        assert created.status_code in {200, 201}
        presentation = created.json()['presentation']
        presentation_id = presentation['id']
        payload = {'presentationId': presentation_id, 'slideId': presentation['slides'][0]['id'], 'kind': 'whiteboard'}
        try:
            with patch.object(socket_manager.sio, 'emit', new_callable=AsyncMock) as emit:
                asyncio.run(socket_manager.controller_state('viewer', payload))
                assert emit.call_args.args[0] == 'presenter_rejected'
                asyncio.run(socket_manager.controller_state('owner', {**payload, 'authToken': token}))
                assert any(call.args[0] == 'presentation_state' and call.args[1]['kind'] == 'whiteboard' for call in emit.call_args_list)
                live = client.get(f'/api/presentations/{presentation_id}/live', headers=headers)
                assert live.json()['kind'] == 'whiteboard'
                asyncio.run(socket_manager.controller_state('owner', {**payload, 'authToken': token, 'kind': 'slide'}))
                assert client.get(f'/api/presentations/{presentation_id}/live', headers=headers).json()['kind'] == 'slide'
        finally:
            client.delete(f'/api/presentations/{presentation_id}', headers=headers)


def sample_board():
    return {'version': 1, 'activePageId': 'page-one', 'pages': [
        {'id': 'page-one', 'title': 'Physics', 'width': 1280, 'height': 720, 'scene': {
            'objects': [{'type': 'path', 'path': [['M', 40, 40], ['L', 100, 100]], 'stroke': '#202329', 'strokeWidth': 4}], 'background': '#fff',
        }},
    ]}


def test_editable_math_metadata_is_preserved_and_validated():
    board = sample_board()
    model = {'version': 1, 'kind': 'fraction', 'expression': 'a*sin(x)', 'parameter': 1, 'minimum': -5, 'maximum': 5, 'numerator': 3, 'denominator': 8, 'position': 0, 'count': 12, 'angle': 45, 'stretch': 1.5}
    board['pages'][0]['scene']['objects'].append({'type': 'group', 'objects': [{'type': 'rect', 'width': 100, 'height': 40}], 'wbMath': model})
    board['pages'][0]['scene']['objects'].append({'type': 'group', 'objects': [{'type': 'path', 'path': [['M', 0, 0], ['L', 10, 10]]}], 'wbLatex': r'\frac{a}{b}'})
    assert validate_document(board)['pages'][0]['scene']['objects'][1]['wbMath'] == model
    model['kind'] = 'untrusted-script'
    with pytest.raises(HTTPException):
        validate_document(board)


def test_cohost_can_save_reconnect_then_loses_write_access_on_demotion():
    with TestClient(fastapi_app) as client:
        token = client.post('/api/auth/login', json={'email': 'owner@presentstudio.local', 'password': 'password123'}).json()['accessToken']
        headers = {'Authorization': f'Bearer {token}'}
        presentation = client.post('/api/presentations', json={'title': 'Co-host science'}, headers=headers).json()['presentation']
        pid = presentation['id']; endpoint = f'/api/presentations/{pid}/whiteboard'
        link = client.post(f'/api/presentations/{pid}/share', json={'permission': 'presenter', 'screenAccessCode': '4321'}, headers=headers).json()['token']
        with SessionLocal() as db:
            live = db.query(LiveSession).filter(LiveSession.presentation_id == pid).first(); live.is_live = True; live.meeting_instance_id = f'instance-{pid}'
            share = db.query(ShareLink).filter(ShareLink.token == link).first()
            grant = MeetingParticipantGrant(id=f'grant-{pid}', presentation_id=pid, meeting_instance_id=live.meeting_instance_id, guest_id=f'guest-{pid}', display_name='Teacher two', role='cohost', status='approved', cohost_share_id=share.id)
            db.add(grant); db.commit()
        client.cookies.clear()
        try:
            board = sample_board(); board['pages'].append({'id': 'private-next-page', 'title': 'Next', 'scene': {'objects': []}})
            assert client.put(f'{endpoint}?token={link}', json={'document': board, 'baseRevision': 0}).status_code == 200
            assert client.put(endpoint, json={'document': board, 'baseRevision': 0}, headers=headers).status_code == 409
            with patch.object(socket_manager.sio, 'enter_room', new_callable=AsyncMock) as entered, patch.object(socket_manager.sio, 'emit', new_callable=AsyncMock) as emitted:
                asyncio.run(socket_manager.whiteboard_join('cohost-new-sid', {'presentationId': pid, 'shareToken': link}))
                entered.assert_awaited_once(); assert len(emitted.call_args.args[1]['document']['pages']) == 2
            with SessionLocal() as db:
                grant = db.get(MeetingParticipantGrant, f'grant-{pid}'); grant.role = 'audience'; db.commit(); resume = create_participant_resume_token(grant)
            assert client.put(f'{endpoint}?token={link}', json={'document': board, 'baseRevision': 1}).status_code == 403
            with patch.object(socket_manager.sio, 'leave_room', new_callable=AsyncMock) as left:
                asyncio.run(socket_manager.whiteboard_join('cohost-new-sid', {'presentationId': pid, 'shareToken': link}))
                left.assert_awaited_once_with('cohost-new-sid', f'whiteboard:{pid}')
            response = client.get(f'{endpoint}?resume={resume}')
            assert response.status_code == 200; assert len(response.json()['document']['pages']) == 1
        finally:
            client.delete(f'/api/presentations/{pid}', headers=headers)


def test_concurrent_board_saves_have_one_winner_not_silent_overwrite():
    with TestClient(fastapi_app) as client:
        token = client.post('/api/auth/login', json={'email': 'owner@presentstudio.local', 'password': 'password123'}).json()['accessToken']
        headers = {'Authorization': f'Bearer {token}'}
        presentation = client.post('/api/presentations', json={'title': 'Concurrent board'}, headers=headers).json()['presentation']
        endpoint = f"/api/presentations/{presentation['id']}/whiteboard"
        try:
            with ThreadPoolExecutor(max_workers=2) as pool:
                saves = list(pool.map(lambda _: client.put(endpoint, json={'document': sample_board(), 'baseRevision': 0}, headers=headers).status_code, range(2)))
            assert sorted(saves) == [200, 409]
            assert client.get(endpoint, headers=headers).json()['document']['revision'] == 1
        finally:
            client.delete(f"/api/presentations/{presentation['id']}", headers=headers)


def test_board_document_is_saved_private_and_revision_checked():
    with TestClient(fastapi_app) as client:
        login = client.post('/api/auth/login', json={'email': 'owner@presentstudio.local', 'password': 'password123'})
        headers = {'Authorization': f"Bearer {login.json()['accessToken']}"}
        created = client.post('/api/presentations', json={'title': 'Science board'}, headers=headers).json()['presentation']
        endpoint = f"/api/presentations/{created['id']}/whiteboard"
        client.cookies.clear()
        try:
            assert client.get(endpoint).status_code in {401, 403}
            assert client.put(endpoint, json={'document': sample_board(), 'baseRevision': 0}).status_code == 403
            editable = sample_board()
            editable['pages'][0]['scene']['objects'].append({'type': 'group', 'objects': [{'type': 'path', 'path': [['M', 0, 0], ['L', 10, 10]]}], 'wbLatex': r'\frac{a}{b}'})
            result = client.put(endpoint, json={'document': editable, 'baseRevision': 0}, headers=headers)
            assert result.status_code == 200
            assert result.json()['revision'] == 1
            saved = client.get(endpoint, headers=headers).json()['document']
            assert saved['pages'][0]['scene']['objects'][0]['type'] == 'path'
            assert saved['revision'] == 1
            assert saved['pages'][0]['scene']['objects'][1]['wbLatex'] == r'\frac{a}{b}'
            assert client.put(endpoint, json={'document': sample_board(), 'baseRevision': 0}, headers=headers).status_code == 409
            response = client.post(f"/api/presentations/{created['id']}/share", json={'permission': 'viewer', 'screenAccessCode': '1234'}, headers=headers)
            assert response.status_code == 200, response.text
            link = response.json()['token']
            assert client.get(f'{endpoint}?token={link}').status_code == 403
            assert client.get(f'{endpoint}?token={link}&screenCode=1234').status_code == 200
            assert client.put(f'{endpoint}?token={link}', json={'document': sample_board(), 'baseRevision': 1}).status_code == 403
            with patch.object(socket_manager.sio, 'enter_room', new_callable=AsyncMock) as room, patch.object(socket_manager.sio, 'emit', new_callable=AsyncMock) as emitted:
                asyncio.run(socket_manager.whiteboard_join('unknown', {'presentationId': created['id']}))
                room.assert_not_awaited()
                asyncio.run(socket_manager.whiteboard_join('viewer', {'presentationId': created['id'], 'shareToken': link, 'screenCode': '1234'}))
                room.assert_awaited_once_with('viewer', f"whiteboard:{created['id']}")
                assert emitted.call_args.args[0] == 'whiteboard_document'
                assert emitted.call_args.args[1]['document']['revision'] == 1
        finally:
            client.delete(f"/api/presentations/{created['id']}", headers=headers)


@pytest.mark.parametrize('change', ['active-page', 'duplicate', 'script-url', 'size', 'dimensions', 'nan'])
def test_board_validation_rejects_invalid_or_unsafe_documents(change):
    board = sample_board()
    if change == 'active-page':
        board['activePageId'] = 'missing'
    elif change == 'duplicate':
        board['pages'].append(board['pages'][0])
    elif change == 'script-url':
        board['pages'][0]['scene']['objects'].append({'type': 'image', 'src': 'javascript:alert(1)'})
    elif change == 'size':
        board['padding'] = 'x' * 750001
    elif change == 'dimensions':
        board['pages'][0]['height'] = 100000
    elif change == 'nan':
        board['pages'][0]['scene']['objects'][0]['left'] = float('nan')
    with pytest.raises(HTTPException):
        validate_document(board)
