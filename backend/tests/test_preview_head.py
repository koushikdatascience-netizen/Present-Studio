from unittest.mock import MagicMock, patch
from uuid import uuid4

from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import fastapi_app
from app.models import Slide, MediaAsset


def test_meeting_link_head_matches_get_and_contains_image_metadata():
    with TestClient(fastapi_app) as client:
        auth = client.post('/api/auth/signup', json={'name': 'Preview Owner', 'email': uuid4().hex+'@example.com', 'password': 'securepass123'}).json()
        headers = {'Authorization': 'Bearer '+auth['accessToken']}
        meeting = client.post('/api/meetings', headers=headers, json={'title': 'Thumbnail meeting'}).json()
        with SessionLocal() as db:
            slide = db.query(Slide).filter(Slide.presentation_id == meeting['presentationId']).first()
            slide.canvas = {'elements': [{'id': 'meeting_media_youtube', 'type': 'youtube', 'youtubeId': 'dQw4w9WgXcQ', 'src': 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'}]}
            db.commit()
        for ua in ['WhatsApp/2.24.1', 'facebookexternalhit/1.1']:
            path = meeting['audienceUrl']+'?preview=202610140002'
            get = client.get(path, headers={'User-Agent': ua})
            head = client.head(path, headers={'User-Agent': ua})
            assert get.status_code == head.status_code == 200
            assert head.content == b''
            assert head.headers['content-length'] == get.headers['content-length']
            assert head.headers['content-type'] == get.headers['content-type']
            assert 'og:image:secure_url' in get.text
            assert '/api/media/youtube/dQw4w9WgXcQ/preview' in get.text


def test_shared_presentation_head_keeps_access_checks():
    with TestClient(fastapi_app) as client:
        auth = client.post('/api/auth/signup', json={'name': 'Share Owner', 'email': uuid4().hex+'@example.com', 'password': 'securepass123'}).json()
        headers = {'Authorization': 'Bearer '+auth['accessToken']}
        deck = client.post('/api/presentations', headers=headers, json={'title': 'Shared deck'}).json()['presentation']
        link = client.post(f"/api/presentations/{deck['id']}/viewer-share", headers=headers, json={}).json()['url']
        get = client.get(link)
        head = client.head(link)
        assert get.status_code == head.status_code == 200
        assert head.content == b'' and head.headers['content-length'] == get.headers['content-length']
        client.delete(f"/api/presentations/{deck['id']}/viewer-share", headers=headers)
        assert client.head(link).status_code == 404


def test_youtube_thumbnail_head_is_bodyless_and_same_length():
    fetched = MagicMock(status_code=200, content=b'jpeg-data', headers={'content-type': 'image/jpeg'})
    with TestClient(fastapi_app) as client, patch('app.routers.media.httpx.get', return_value=fetched):
        path = '/api/media/youtube/dQw4w9WgXcQ/preview'
        get, head = client.get(path), client.head(path)
        assert get.status_code == head.status_code == 200
        assert head.content == b''
        assert head.headers['content-length'] == str(len(get.content))
        assert head.headers['content-type'] == 'image/jpeg'
        assert client.head('/api/media/youtube/invalid/preview').status_code == 404


def test_asset_preview_head_closes_storage_body_without_streaming():
    storage = MagicMock()
    storage.media_key.side_effect = lambda owner, asset: f'media/{owner}/{asset}'
    body = MagicMock()
    storage.client.get_object.return_value = {'Body': body, 'ContentLength': 74441, 'ContentType': 'image/jpeg'}
    with TestClient(fastapi_app) as client:
        auth = client.post('/api/auth/signup', json={'name': 'Asset Owner', 'email': uuid4().hex+'@example.com', 'password': 'securepass123'}).json()
        asset_id = 'asset_'+uuid4().hex
        with SessionLocal() as db:
            db.add(MediaAsset(id=asset_id, owner_id=auth['user']['id'], name='Video', mime_type='video/mp4', url=f'/api/media/{asset_id}/content', size=10))
            db.commit()
        with patch('app.routers.media.s3_storage', return_value=storage):
            head = client.head(f'/api/media/{asset_id}/preview')
            assert head.status_code == 200 and head.content == b''
            assert head.headers['content-length'] == '74441'
            body.close.assert_called_once()
            body.iter_chunks.assert_not_called()
            assert client.head('/api/media/asset_missing/preview').status_code == 404
