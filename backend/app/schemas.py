from datetime import datetime
from typing import Any, Literal
from pydantic import BaseModel, Field


SharePermission = Literal["viewer", "presenter"]


class LoginRequest(BaseModel):
    email: str
    password: str


class SignupRequest(BaseModel):
    name: str
    email: str
    password: str


class UserOut(BaseModel):
    id: str
    name: str
    email: str
    role: str
    presentationLimit: int


class PresentationLimitUpdate(BaseModel):
    presentationLimit: int = Field(ge=0, le=100000)


class StorageLimitUpdate(BaseModel):
    storageLimitBytes: int | None = Field(default=None, ge=0, le=1024 * 1024 * 1024 * 1024)


class AuthOut(BaseModel):
    user: UserOut
    accessToken: str


class SlideIn(BaseModel):
    id: str
    order: int
    title: str
    canvas: dict[str, Any]


class SlideOut(SlideIn):
    pass


class PresentationCreate(BaseModel):
    title: str


class PresentationSave(BaseModel):
    id: str
    title: str
    slides: list[SlideIn]


class PresentationOut(BaseModel):
    id: str
    title: str
    ownerId: str
    status: str
    updatedAt: str | None = None
    slides: list[SlideOut]


class PresentationPayload(BaseModel):
    presentation: PresentationOut
    permission: SharePermission
    resumeGuestId: str | None = None
    resumeDisplayName: str | None = None


class ShareLinkCreate(BaseModel):
    permission: SharePermission = "viewer"
    screenAccessCode: str | None = Field(default=None, pattern=r"^\d{4}$")


class ShareLinkOut(BaseModel):
    url: str
    token: str
    permission: SharePermission
    requiresScreenCode: bool = False
    screenUrl: str | None = None
    screenToken: str | None = None
    audienceUrl: str | None = None


class ShareLinkResolveOut(BaseModel):
    presentationId: str
    standaloneMeeting: bool = False
    meetingAccessType: Literal["public", "private"] | None = None


class LiveMediaTokenRequest(BaseModel):
    displayName: str | None = Field(default=None, max_length=80)
    shareToken: str = Field(default="", max_length=200)
    resumeToken: str = Field(default="", max_length=1200)
    screenAccessCode: str | None = Field(default=None, pattern=r"^\d{4}$")
    clientId: str = Field(default="", max_length=128)


class LiveMediaTokenOut(BaseModel):
    url: str
    token: str
    roomName: str
    participantIdentity: str
    participantName: str
    permission: SharePermission


class ScreenAccessRequest(BaseModel):
    token: str
    screenAccessCode: str = Field(pattern=r"^\d{4}$")


class MediaAssetOut(BaseModel):
    id: str
    name: str
    mimeType: str
    url: str
    size: int


class LiveSlideEvent(BaseModel):
    presentationId: str
    slideId: str
    mode: Literal["presenter", "audience"] = "presenter"


class LiveSlideUpdate(BaseModel):
    slideId: str


class LiveSessionOut(BaseModel):
    presentationId: str
    activeSlideId: str | None = None
    isLive: bool
    kind: str = "slide"
    mediaId: str | None = None
    position: float = 0.0
    playing: bool = False
    muted: bool = False
    videoVolume: float = 1.0
    audioVolume: float = 1.0
    serverTime: int | None = None


class MeetingCreate(BaseModel):
    title: str = Field(default="New meeting", max_length=255)
    timingMode: Literal["instant", "scheduled"] = "instant"
    durationMode: Literal["unlimited", "timed"] = "unlimited"
    accessType: Literal["public", "private"] = "public"
    scheduledStart: datetime | None = None
    scheduledEnd: datetime | None = None


class MeetingOut(BaseModel):
    id: str
    presentationId: str
    title: str
    timingMode: Literal["instant", "scheduled"]
    durationMode: Literal["unlimited", "timed"]
    accessType: Literal["public", "private"]
    scheduledStart: str
    scheduledEnd: str | None = None
    status: str
    audienceUrl: str
    controllerUrl: str
    accessCode: str | None = None
