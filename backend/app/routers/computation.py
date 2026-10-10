from datetime import datetime, timedelta, timezone
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from ..config import get_settings
from ..database import get_db
from ..models import MathComputeUsage, Presentation
from ..security import can_present_with_credentials
from pydantic import BaseModel, ConfigDict, Field
from typing import Literal


router = APIRouter(prefix='/api/presentations', tags=['computation'])


class ComputeRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    operation: Literal['differentiate', 'integrate', 'definite_integral', 'limit', 'series', 'solve', 'eigenvalues', 'rref']
    expression: str = Field(default='x', min_length=1, max_length=500)
    lower: str = Field(default='0', max_length=80)
    upper: str = Field(default='1', max_length=80)
    point: str = Field(default='0', max_length=80)
    direction: Literal['+', '-', '+-'] = '+-'
    order: int = Field(default=6, ge=1, le=15)
    matrix: list[list[str]] = Field(default_factory=list, max_length=6)


def reserve(db, owner_id, limit):
    today = datetime.now(timezone.utc)
    day = today.date().isoformat()
    key = {'owner_id': owner_id, 'day': day}
    if not db.get(MathComputeUsage, (owner_id, day)):
        try:
            db.add(MathComputeUsage(**key, calls=0)); db.commit()
        except IntegrityError:
            db.rollback()
    result = db.execute(update(MathComputeUsage).where(MathComputeUsage.owner_id == owner_id, MathComputeUsage.day == day, MathComputeUsage.calls < limit).values(calls=MathComputeUsage.calls + 1))
    db.commit()
    if result.rowcount != 1:
        reset = datetime.combine(today.date() + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)
        raise HTTPException(429, 'Daily advanced-computation quota reached', headers={'Retry-After': str(max(1, int((reset - today).total_seconds())))})
    db.expire_all()
    return max(0, limit - db.get(MathComputeUsage, (owner_id, day)).calls)


@router.post('/{presentation_id}/compute')
async def compute(presentation_id: str, payload: ComputeRequest, request: Request, db: Session = Depends(get_db)):
    presentation = db.get(Presentation, presentation_id)
    auth = request.headers.get('authorization', '')
    if not presentation or not can_present_with_credentials(db, presentation, auth_token=auth[7:] if auth.lower().startswith('bearer ') else '', share_token=request.query_params.get('token', '')):
        raise HTTPException(403, 'Presenter permission required')
    settings = get_settings()
    if not settings.compute_service_url or not settings.compute_service_key:
        raise HTTPException(503, 'Advanced computation service is not enabled')
    if any(len(row) > 6 or any(len(value) > 80 for value in row) for row in payload.matrix):
        raise HTTPException(422, 'Matrix entry limit exceeded')
    remaining = reserve(db, presentation.owner_id, max(0, settings.compute_daily_quota))
    try:
        async with httpx.AsyncClient(timeout=12, follow_redirects=False) as client:
            response = await client.post(settings.compute_service_url.rstrip('/') + '/calculate', json=payload.model_dump(), headers={'X-Compute-Key': settings.compute_service_key})
        if response.status_code != 200:
            status = response.status_code if response.status_code in {422, 429, 504} else 503
            raise HTTPException(status, response.json().get('detail', 'Computation failed'))
        if len(response.content) > 50000:
            raise HTTPException(502, 'Computation response exceeded limits')
        return {**response.json(), 'quotaRemaining': remaining}
    except httpx.TimeoutException:
        raise HTTPException(504, 'Advanced computation timed out')
    except (httpx.RequestError, ValueError):
        raise HTTPException(503, 'Advanced computation service unavailable')
