from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
import socketio
from sqlalchemy import inspect, text
from .config import get_settings
from .database import Base, SessionLocal, engine
from .models import User, ShareLink, Presentation, Meeting, Slide
from .database import get_db
from sqlalchemy.orm import Session
from datetime import datetime, timezone
from html import escape
from urllib.parse import urljoin, urlsplit
import re
from .socket_manager import sio
from . import meeting_v2
from . import breakout
from .routers import admin, auth, media, meetings, presentations, computation
from .security import admin_user
from .seed import seed_demo_data


meeting_v2.install_router_guards(presentations)


settings = get_settings()
fastapi_app = FastAPI(title=settings.app_name)

fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@fastapi_app.on_event("startup")
def startup() -> None:
    Base.metadata.create_all(bind=engine)
    repair_local_sqlite_schema()
    repair_share_link_schema()
    repair_live_session_schema()
    db = SessionLocal()
    try:
        seed_demo_data(db)
    finally:
        db.close()


def repair_local_sqlite_schema() -> None:
    if not settings.database_url.startswith("sqlite"):
        return
    inspector = inspect(engine)
    if "users" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("users")}
    with engine.begin() as connection:
        if "password_hash" not in columns:
            connection.execute(text("ALTER TABLE users ADD COLUMN password_hash VARCHAR(255)"))
        if "is_active" not in columns:
            connection.execute(text("ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT 1 NOT NULL"))
        if "presentation_limit" not in columns:
            connection.execute(text("ALTER TABLE users ADD COLUMN presentation_limit INTEGER DEFAULT 10 NOT NULL"))
        if "storage_limit_bytes" not in columns:
            connection.execute(text("ALTER TABLE users ADD COLUMN storage_limit_bytes BIGINT"))


def repair_share_link_schema() -> None:
    """Repair pre-migration SQLite and PostgreSQL databases on startup."""
    inspector = inspect(engine)
    if "share_links" not in inspector.get_table_names():
        return
    share_columns = {column["name"] for column in inspector.get_columns("share_links")}
    statements = share_link_repair_statements(engine.dialect.name, share_columns)
    if not statements:
        return
    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))


def share_link_repair_statements(dialect_name: str, columns: set[str]) -> list[str]:
    """Return ALTER statements needed by older share_links tables."""
    is_sqlite = dialect_name == "sqlite"
    bool_default = "1" if is_sqlite else "TRUE"
    timestamp_type = "DATETIME" if is_sqlite else "TIMESTAMP WITH TIME ZONE"
    statements: list[str] = []
    if "screen_access_code_hash" not in columns:
        statements.append("ALTER TABLE share_links ADD COLUMN screen_access_code_hash VARCHAR(255)")
    if "is_active" not in columns:
        statements.append(f"ALTER TABLE share_links ADD COLUMN is_active BOOLEAN DEFAULT {bool_default} NOT NULL")
    if "expires_at" not in columns:
        statements.append(f"ALTER TABLE share_links ADD COLUMN expires_at {timestamp_type}")
    if "created_at" not in columns:
        statements.append(f"ALTER TABLE share_links ADD COLUMN created_at {timestamp_type} DEFAULT CURRENT_TIMESTAMP")
    return statements


def repair_live_session_schema() -> None:
    """Keep databases created before media-state persistence usable."""
    inspector = inspect(engine)
    if "breakout_rooms" in inspector.get_table_names() and "closing_at" not in {column["name"] for column in inspector.get_columns("breakout_rooms")}:
        with engine.begin() as connection:
            connection.execute(text("ALTER TABLE breakout_rooms ADD COLUMN closing_at FLOAT"))
    if "live_sessions" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("live_sessions")}
    statements = live_session_repair_statements(engine.dialect.name, columns)
    if not statements:
        return
    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))


def live_session_repair_statements(dialect_name: str, columns: set[str]) -> list[str]:
    is_sqlite = dialect_name == "sqlite"
    bool_default = "0" if is_sqlite else "FALSE"
    timestamp_type = "DATETIME" if is_sqlite else "TIMESTAMP WITH TIME ZONE"
    definitions = {
        "meeting_instance_id": "VARCHAR(64)",
        "active_media_id": "VARCHAR(128)",
        "active_media_kind": "VARCHAR(16) DEFAULT 'slide' NOT NULL",
        "media_position": "FLOAT DEFAULT 0 NOT NULL",
        "media_playing": f"BOOLEAN DEFAULT {bool_default} NOT NULL",
        "media_muted": f"BOOLEAN DEFAULT {bool_default} NOT NULL",
        "video_volume": "FLOAT DEFAULT 1 NOT NULL",
        "audio_volume": "FLOAT DEFAULT 1 NOT NULL",
        "media_updated_at": timestamp_type,
        "featured_share_identity": "VARCHAR(128)",
        "featured_camera_identity": "VARCHAR(128)",
        "meeting_muted": f"BOOLEAN DEFAULT {bool_default} NOT NULL",
        "muted_participant_identities": "TEXT DEFAULT '[]' NOT NULL",
        "whiteboard_document": "TEXT",
    }
    return [
        f"ALTER TABLE live_sessions ADD COLUMN {name} {definition}"
        for name, definition in definitions.items()
        if name not in columns
    ]


@fastapi_app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


fastapi_app.include_router(auth.router)
fastapi_app.include_router(presentations.router)
fastapi_app.include_router(meetings.router)
fastapi_app.include_router(media.router)
fastapi_app.include_router(admin.router)
fastapi_app.include_router(computation.router)


@fastapi_app.get("/admin", include_in_schema=False)
@fastapi_app.get("/admin.html", include_in_schema=False)
def admin_dashboard(_: User = Depends(admin_user)) -> FileResponse:
    return FileResponse(settings.frontend_dir / "admin.html")


@fastapi_app.get("/join/{token}", include_in_schema=False)
def audience_join(token: str, request: Request, db: Session = Depends(get_db)) -> HTMLResponse:
    """Include link-card metadata before the audience app executes."""
    base = presentations.public_share_base_url(request)
    title = "Join a meeting | SnapKey Studio"
    description = "Join the live conversation on SnapKey Studio."
    image = f"{base}/assets/snapkey.png"
    share = db.query(ShareLink).filter(ShareLink.token == token, ShareLink.is_active.is_(True)).first()
    expiry = share.expires_at if share else None
    if expiry and expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)
    if share and (not expiry or expiry > datetime.now(timezone.utc)):
        presentation = db.get(Presentation, share.presentation_id)
        meeting = db.query(Meeting).filter(Meeting.presentation_id == share.presentation_id).first()
        private = bool(meeting and meeting.access_type == "private") or bool(share.screen_access_code_hash)
        if presentation:
            title = f"{presentation.title} | SnapKey Studio"
            description = "Private meeting. Entry is limited to permitted participants." if private else "You're invited. Join this live meeting on SnapKey Studio."
            if not private or meeting:
                slides = db.query(Slide).filter(Slide.presentation_id == presentation.id).order_by(Slide.order).all()
                for slide in slides:
                    scene = slide.canvas or {}
                    items = list(scene.get("elements") or []) + list((scene.get("fabric") or {}).get("objects") or [])
                    if private:
                        items = [item for item in items if str(item.get("id", "")).startswith("meeting_media_")]
                    visual = next((item for item in items if (item.get("mediaType") or item.get("type")) in {"image", "video", "youtube"} and item.get("src")), None)
                    if not visual:
                        continue
                    candidate = visual["src"]
                    kind = visual.get("mediaType") or visual.get("type")
                    if kind == "youtube":
                        video_id = str(visual.get("youtubeId", ""))
                        if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
                            continue
                        candidate = f"/api/media/youtube/{video_id}/preview"
                    elif candidate.startswith("/api/media/") and candidate.endswith("/content"):
                        candidate = candidate.removesuffix("/content") + "/preview"
                    elif kind == "video":
                        if "res.cloudinary.com" in candidate:
                            candidate = candidate.rsplit(".", 1)[0] + ".jpg"
                        else:
                            continue
                    absolute = urljoin(base + "/", candidate)
                    if urlsplit(absolute).scheme in {"https", "http"}:
                        image = absolute
                        break
    canonical = f"{base}/join/{token}"
    revision = request.query_params.get("preview", "")
    if re.fullmatch(r"[a-f0-9]{12}", revision):
        canonical += f"?preview={revision}"
    tags = {"og:type": "website", "og:site_name": "SnapKey Studio", "og:title": title, "og:description": description, "og:url": canonical, "og:image": image, "og:image:alt": title}
    metadata = "\n".join(f'<meta property="{key}" content="{escape(value, quote=True)}">' for key, value in tags.items())
    metadata += f'\n<meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="{escape(image, quote=True)}">'
    metadata += f'\n<meta name="description" content="{escape(description, quote=True)}">'
    page = (settings.frontend_dir / "present.html").read_text(encoding="utf-8")
    page = page.replace("<title>Present Studio - Present</title>", f"<title>{escape(title)}</title>")
    return HTMLResponse(page.replace("</head>", metadata + "\n</head>"), headers={"Cache-Control": "no-cache"})

fastapi_app.mount("/", StaticFiles(directory=settings.frontend_dir, html=True), name="frontend")

app = socketio.ASGIApp(sio, other_asgi_app=fastapi_app)
