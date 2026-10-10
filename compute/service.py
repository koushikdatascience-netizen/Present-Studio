import hmac
import json
import os
import subprocess
import sys
from threading import BoundedSemaphore

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from typing import Literal


app = FastAPI(title='SnapKey isolated computation', docs_url=None, redoc_url=None, openapi_url=None)
slots = BoundedSemaphore(1)


class Computation(BaseModel):
    model_config = ConfigDict(extra='forbid')
    operation: Literal['differentiate', 'integrate', 'definite_integral', 'limit', 'series', 'solve', 'eigenvalues', 'rref']
    expression: str = Field(default='x', min_length=1, max_length=500)
    lower: str = Field(default='0', max_length=80)
    upper: str = Field(default='1', max_length=80)
    point: str = Field(default='0', max_length=80)
    direction: Literal['+', '-', '+-'] = '+-'
    order: int = Field(default=6, ge=1, le=15)
    matrix: list[list[str]] = Field(default_factory=list, max_length=6)


@app.get('/health')
def health():
    return {'status': 'ok'}


@app.post('/calculate')
def calculate(payload: Computation, x_compute_key: str = Header(default='')):
    key = os.getenv('COMPUTE_SERVICE_KEY', '')
    if not key or not hmac.compare_digest(key, x_compute_key):
        raise HTTPException(403, 'Service authentication required')
    if any(len(row) > 6 or any(len(value) > 80 for value in row) for row in payload.matrix):
        raise HTTPException(422, 'Matrix entry limit exceeded')
    if not slots.acquire(blocking=False):
        raise HTTPException(429, 'Computation service is busy', headers={'Retry-After': '2'})
    try:
        result = subprocess.run([sys.executable, '-m', 'compute.worker'], input=payload.model_dump_json(), capture_output=True, text=True, timeout=10, check=False)
        if result.returncode or len(result.stdout) > 50000:
            raise HTTPException(422, 'Computation exceeded resource limits')
        response = json.loads(result.stdout)
        if response.get('error'):
            raise HTTPException(422, response['error'])
        return response
    except subprocess.TimeoutExpired:
        raise HTTPException(504, 'Computation timed out')
    except (ValueError, OSError):
        raise HTTPException(503, 'Computation worker unavailable')
    finally:
        slots.release()
