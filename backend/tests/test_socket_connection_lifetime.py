import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import QueuePool

from app import breakout, socket_manager
from app.database import Base
from app.models import LiveSession, Presentation, User


@pytest.fixture
def join_pool(tmp_path, monkeypatch):
    # One connection makes a socket await inside an open transaction fail
    # immediately when the transport needs database access for another event.
    engine = create_engine(
        'sqlite:///' + (tmp_path / 'joins.db').as_posix(),
        poolclass=QueuePool, pool_size=1, max_overflow=0, pool_timeout=0.05,
    )
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine)
    with sessions() as db:
        db.add(User(id='owner', name='Owner', email='pool@example.test', password_hash='unused'))
        db.add(Presentation(id='deck', title='Pool test', owner_id='owner'))
        db.add(LiveSession(id='live', presentation_id='deck', is_live=True, audience_count=0))
        db.commit()
    monkeypatch.setattr(socket_manager, 'SessionLocal', sessions)

    async def transport(*args, **kwargs):
        with sessions() as db:
            assert db.execute(text('SELECT 1')).scalar() == 1
        await asyncio.sleep(0)

    emit = AsyncMock(side_effect=transport)
    monkeypatch.setattr(socket_manager.sio, 'emit', emit)
    monkeypatch.setattr(socket_manager.sio, 'enter_room', AsyncMock(side_effect=transport))
    monkeypatch.setattr(socket_manager.sio, 'leave_room', AsyncMock(side_effect=transport))
    yield sessions, transport, emit
    engine.dispose()


def test_simultaneous_joins_release_connections_before_emitting(join_pool):
    sessions, _, emit = join_pool

    async def join_all():
        await asyncio.gather(*(socket_manager.join_presentation(f'sid-{i}', {'presentationId': 'deck'}) for i in range(20)))

    asyncio.run(join_all())
    with sessions() as db:
        assert db.get(LiveSession, 'live').audience_count == 20
    assert sum(call.args[0] == 'presentation_state' for call in emit.await_args_list) == 20


@pytest.mark.parametrize('allowed', [True, False])
def test_breakout_session_and_rejection_io_happen_after_connection_release(join_pool, monkeypatch, allowed):
    sessions, transport, _ = join_pool
    with sessions() as db:
        db.get(Presentation, 'deck').status = 'breakout'
        db.commit()

    def authorize(*args):
        if not allowed:
            raise HTTPException(403, 'Assignment required')
        return None, None, None, None, SimpleNamespace(guest_id='guest')

    async def get_session(*args):
        await transport()
        return {}

    monkeypatch.setattr(breakout, 'authorize', authorize)
    monkeypatch.setattr(breakout, 'enforce_assignment', lambda *args: None)
    monkeypatch.setattr(socket_manager.sio, 'get_session', AsyncMock(side_effect=get_session))
    monkeypatch.setattr(socket_manager.sio, 'save_session', AsyncMock(side_effect=transport))
    asyncio.run(socket_manager.join_presentation('guest-sid', {'presentationId': 'deck'}))
    if allowed:
        socket_manager.sio.save_session.assert_awaited_once_with('guest-sid', {
            'breakout_guest_id': 'guest', 'breakout_presentation_id': 'deck',
        })
    else:
        socket_manager.sio.leave_room.assert_awaited_once_with('guest-sid', 'deck')
        socket_manager.sio.enter_room.assert_not_awaited()
