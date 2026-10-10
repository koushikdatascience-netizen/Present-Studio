import subprocess
from unittest.mock import patch
from fastapi.testclient import TestClient
from compute.service import app


def test_service_key_validation_and_worker_timeout(monkeypatch):
    monkeypatch.setenv('COMPUTE_SERVICE_KEY', 'test-key')
    client = TestClient(app)
    assert client.post('/calculate', json={'operation': 'differentiate'}).status_code == 403
    with patch('compute.service.subprocess.run', side_effect=subprocess.TimeoutExpired('worker', 10)):
        assert client.post('/calculate', json={'operation': 'differentiate'}, headers={'X-Compute-Key': 'test-key'}).status_code == 504
    with patch('compute.service.subprocess.run') as run:
        run.return_value = subprocess.CompletedProcess([], 0, '{"result":"2*x"}', '')
        assert client.post('/calculate', json={'operation': 'differentiate'}, headers={'X-Compute-Key': 'test-key'}).json()['result'] == '2*x'
