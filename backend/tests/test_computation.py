from unittest.mock import patch
from fastapi import HTTPException
from fastapi.testclient import TestClient
import pytest
from app.main import fastapi_app
from app.database import SessionLocal
from app.models import MathComputeUsage
from app.routers.computation import reserve
from app.config import get_settings


def test_computation_authorization_disabled_service_and_daily_quota():
    with TestClient(fastapi_app) as client:
        token = client.post('/api/auth/login', json={'email': 'owner@presentstudio.local', 'password': 'password123'}).json()['accessToken']
        headers = {'Authorization': f'Bearer {token}'}
        created = client.post('/api/presentations', json={'title': 'Computation tests'}, headers=headers).json()['presentation']
        endpoint = f"/api/presentations/{created['id']}/compute"
        client.cookies.clear()
        try:
            assert client.post(endpoint, json={'operation': 'differentiate'}).status_code == 403
            with patch.object(get_settings(), 'compute_service_url', ''):
                assert client.post(endpoint, json={'operation': 'differentiate'}, headers=headers).status_code == 503
            with SessionLocal() as db:
                db.query(MathComputeUsage).filter(MathComputeUsage.owner_id == created['ownerId']).delete(); db.commit()
                assert reserve(db, created['ownerId'], 2) == 1
                assert reserve(db, created['ownerId'], 2) == 0
                with pytest.raises(HTTPException) as error:
                    reserve(db, created['ownerId'], 2)
                assert error.value.status_code == 429
                db.query(MathComputeUsage).filter(MathComputeUsage.owner_id == created['ownerId']).delete(); db.commit()
        finally:
            client.delete(f"/api/presentations/{created['id']}", headers=headers)
