import asyncio
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app import socket_manager
from app.main import fastapi_app


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
