# SnapKey Studio attended remote assistance

Status: feature branch only; disabled by default. No main merge or production deployment.
Repository base: koushikdatascience-netizen/Present-Studio main 1a6472d4fc2008be48eb9b709b06ca6830eeab57, fetched before implementation. This is distinct from the currently deployed MadhushalaReport/SnapkeyStudio repository. Do not deploy this older base over production without reconciling the existing performance and preview changes.

## Architecture and scope

FastAPI and the existing Socket.IO server provide the control plane. Only the authenticated presentation owner, connected through the existing controller registry, can request control. Ordinary editor, presenter share-link, and co-host permissions do not grant remote control. Guests bind through their existing admitted Socket.IO connection; a guest ID, display name or share URL alone cannot authorize pairing.

The current meeting, LiveKit room, screen-sharing publications, chat and slide synchronization stay in place. A Request Control button is attached to remote screen-share gallery tiles and embedded screen-share tiles. The guest receives a meeting dialog and may deny, generate a one-time ticket, or download the signed helper when available. The owner sees a separate interactive surface inside the meeting overlay, with Release and Fullscreen controls. Escape releases control. Keyboard focus, tab visibility and disconnect handling prevent accidental background input.

The browser cannot identify the physical Windows display behind an arbitrary LiveKit screen track. This version deliberately uses an explicitly approved **primary-monitor-only** native JPEG preview for the interactive surface. Existing LiveKit screen sharing continues unchanged. Native preview: up to 5 fps, 1280x720 bounds, JPEG quality 60; no native audio capture. This is a functional assistance baseline, not a high-frame-rate remote desktop product. Window/tab sharing does not implicitly authorize their surrounding desktop: the native consent explicitly describes the entire primary display.

Reliable WSS carries helper approval, input and leases; existing reliable Socket.IO carries controller input and targeted JPEG frames. LiveKit supports reliable and lossy data packets, but LiveKit-only delivery would still require a native client plus independent authorization and verified monitor mapping. A future measured implementation can move preview/input to WebRTC while preserving these authorization checks.

## API

All browser REST endpoints use a short-lived, in-memory capability issued as the acknowledgement of `remote_control_bind` on an already admitted meeting socket. It is not the account JWT. Owner binding additionally validates the account JWT and ownership. Capabilities are not stored in localStorage or cookies.

- `POST /api/remote-control/request` `{targetIdentity}`: owner only.
- `POST /api/remote-control/ticket` `{sessionId}`: target guest only, once per request.
- `POST /api/remote-control/pair` `{ticket}`: consume a 256-bit one-time ticket; return helper capability and verified owner identity.
- `POST /api/remote-control/approve`: always rejects browser approval. Actual approval is a message on the helper's authenticated WSS connection.
- `POST /api/remote-control/deny`, `/revoke` `{sessionId}`: exact requesting owner or target guest.
- `GET /api/remote-control/status?sessionId=...`: exact owner or target guest.
- `GET /api/remote-control/download`: target guest credential; signed release must be provisioned first.
- `WSS /api/remote-control/helper`: credentials in first frame, never query parameters. Approval, heartbeat, stop and native frames.

Socket events: `remote_control_bind`, `remote_control_heartbeat`, `remote_control_input`, `remote_control_status`, `remote_control_frame`. Input is a fixed validated schema, not arbitrary text, shell commands or executable instructions.

## Build

Windows prerequisites: Visual Studio Build Tools with C++/Windows SDK, Rustup, Rust 1.93.0. The feature CI runs Windows native tests and creates a portable x64 executable. Install/build tools only on your development machine or CI, not the active meeting server.

```
powershell -File remote-assist/scripts/build.ps1
```

For an isolated HTTPS staging hostname, embed the trusted origin at build time:

```
powershell -File remote-assist/scripts/build.ps1 -TrustedOrigin https://remote-assist-staging.snapkeystudio.com
```

The helper rejects origins other than its compile-time trusted HTTPS origin, including redirects. No development HTTP bypass is included. The resulting executable is portable and standard-user; no service, startup entry, extension or persistent credential is created. Existing helper users may explicitly enable Open Helper links using the idle native helper button. This registers only a per-user URL protocol pointing to the current executable; no service/startup entry or credential is added. Studio then offers Open Helper with normal browser/OS confirmation. Launching only prefills the pairing text: Connect and native Allow Control remain explicit. Registration can be removed with the native button. If the helper is already running, paste into that window instead of launching a second instance.

Sign with an organization-owned Authenticode certificate:

```
powershell -File remote-assist/scripts/build.ps1 -Sign -CertificateThumbprint YOUR_CERTIFICATE_THUMBPRINT
```

The unsigned CI artifact is for controlled development tests only. Do not publish it through the guest download endpoint. `scripts/verify-release.ps1` requires a valid Authenticode signature before copying to a release directory and reporting SHA256. Never bypass SmartScreen, browser prompts, UAC or enterprise policy.

## Deployment (requires separate approval)

Use a staging instance first. This feature uses in-memory authorization and must have **one ASGI worker and one backend replica**. Process restart revokes all requests. A future shared broker is required before scaling it across workers. Do not enable it on multiple replicas behind a load balancer.

1. Back up the database. Apply `backend/alembic/versions/20261015_0008_remote_control.py` with the existing Alembic migration process. The existing startup `create_all` path also creates the new table. Only a metadata audit table is added; no existing meeting tables change.
2. Review `deploy/remote-control.compose.yml` together with the existing compose file. The overlay caps WebSocket message size at 512KiB and enforces one worker. Do not replace other service configuration or restart LiveKit/Caddy/other projects.
3. Set `REMOTE_CONTROL_ENABLED=true` only on the approved staging instance. Mount the signature-verified helper release directory read-only. Set `REMOTE_ASSIST_SHA256` to the SHA256 of the signed binary. The endpoint validates bytes against this operator-approved hash; it does not independently perform Windows certificate-chain validation on Linux.
4. Reverse proxy HTTPS/WSS and Socket.IO as for existing meeting routes. Apply ingress request/connection limits, trusted proxy IP configuration and same-origin TLS; do not expose database or extra guest ports. The helper needs only outbound HTTPS/WSS 443.
5. Verify all manual tests before production enablement. Keep the feature off on the public server until approval.
6. Rollback: set `REMOTE_CONTROL_ENABLED=false` and roll only this backend in a maintenance window. Process shutdown invalidates control. Keep the additive audit table for investigation; do not roll back unrelated schema or LiveKit services.

No deployment workflow, DNS, running meeting, VPS service, or production database was changed by implementing this branch.

## Security and lifecycle

See [SECURITY.md](SECURITY.md) and [MANUAL-TEST.md](MANUAL-TEST.md). The durable `remote_control_audit` table records session/meeting/controller/guest IDs, transition and timestamp. Input events, screenshots, pairing secrets, clipboard and typed text are never stored by this feature. Operational logs should not log bodies or authorization headers. Set an audit retention policy appropriate to the organization.

## Remaining release gates

- Obtain and apply a valid organization-owned code-signing certificate; verify the actual published bytes.
- Complete two-real-Windows-computer tests on separate networks, including DPI, display changes, secure desktop, browser throttling and forced termination.
- Confirm smoothness/latency and bandwidth with representative meetings; the native JPEG stream adds server egress.
- No Unicode/IME text injection, clipboard, file transfer, secondary-monitor control, elevated-window control, unattended access, recording or remote shell. Optional Open Helper links require the user to enable per-user protocol registration first; otherwise manual opening/pasting works.
- Helper native tests check ABI; they do not establish real-device input correctness. A compile success is not end-to-end consent or revocation verification.
- Co-host/presenter control is intentionally not enabled. Only the meeting owner may request.
- The older branch base has pre-existing regression failures; see validation report. Reconcile with production performance fixes before considering deployment.
