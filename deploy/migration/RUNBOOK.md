# Tonight's migration — PREPARATION ONLY

No server commands or DNS writes were executed while preparing this directory. The current production app remains on AWS. The 8-core/32GB VPS at 200.97.169.48 already runs LiveKit, Camera Eye and n8n. The prepared deployment uses a separate `snapkey-vps` Compose project, a new private database volume, and only 127.0.0.1:18474 for the app. LiveKit/Camera Eye/n8n containers must not be recreated.

## What is ready offline

- Production-compatible remote-assistance branch and full passing integration CI (131 backend tests, frontend/TypeScript/browser checks).
- Standalone `compose.vps.yml`: backend capped at 2 CPU/4GB, PostgreSQL at 1 CPU/2GB, bounded logs, private DB and localhost-only app port.
- `env.vps.example`: placeholders only. Keep the existing JWT secret, S3 bucket/prefix, LiveKit credentials and public hostname. Generate a NEW 64-character hex PostgreSQL password for the new private DB, never reuse the example/default password.
- Additive Caddy host fragment; preserve the complete current configuration and every other hostname.
- CI-only Linux image build, isolated health/disabled-feature smoke test and checksum-protected image artifact. No SSH or deployment occurs in this workflow.
- The legacy AWS deploy workflow is gated in this branch: merging runs validation, but deploying requires an explicit manual confirmation. This gate takes effect only when merged; the current main workflow has not been changed yet.
- Previously prepared AWS backup: `/srv/projects/present-studio-backups/remote-assist-prepared-20261015-085725`, checksums verified. This is a preparation snapshot, not the final cutover backup.

## Decisions and access required at the actual window

The owner must explicitly authorize the maintenance window and confirm all relevant meetings have finished. Re-read actual LiveKit room/participant counts; stored `is_live` flags can be stale. Confirm DNS account access, record type, TTL, existing IPv6/AAAA records and exact rollback record configuration. Do not use transient AWS ALB answer IPs as the rollback configuration.

Confirm the actual VPS port is still free and resources healthy, available disk for database/image backups, and the current container IDs before making changes. Do not reboot, upgrade the operating system, prune Docker, modify unrelated project directories or run a global Compose down/restart.

The image is prepared in GitHub CI to avoid building on the crowded AWS host or the live-meeting VPS. The image artifact, source archive and manifest must agree on the release commit. Download/verify SHA256 on the destination before Docker load.

## TLS and shared-proxy gate

The VPS already owns 80/443 through its shared Caddy container. A valid certificate for `connect.snapkeystudio.com` is required before advertising the new endpoint. Prefer a pre-issued certificate/DNS-01 issuance using the authorized DNS account, then verify direct-to-VPS HTTPS using SNI before changing DNS. Do not assume the current AWS ACM certificate's private key is available or that the LiveKit hostname's certificate covers the app hostname.

If pre-issuance is unavailable, HTTP-01 issuance may require DNS to point at the VPS first and can create a TLS gap. Do not silently accept that gap: establish an approved certificate/cutover method first. Old cached DNS answers may continue to reach AWS until their original TTL expires.

Validate a COPY of the full existing Caddy configuration plus the new host before applying it. Caddy is shared with LiveKit and Camera Eye. A graceful reload does not restart those containers, but reverse-proxy configuration unload can close existing WebSockets. Do not reload while protected streams/meetings are active, or claim zero interruption without a verified strategy. `stream_close_delay` configured in the already-active handler affects this behavior; adding it at the same reload is not a guarantee for pre-existing connections. Preserve all other routes and establish an agreed quiet window for this shared-proxy operation.

Sources: https://caddyserver.com/docs/command-line and https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#streaming .

## Execution order (not executed now)

1. Confirm maintenance authorization, no active meetings/streams and signing-feature state. Keep remote control OFF; the helper artifact is unsigned and real-device acceptance remains outstanding.
2. Record original DNS configuration, AWS target/port/running image, current Caddyfile/config, database counts and deployment env. Back up these with restricted permissions. Retain AWS files, image and database for rollback.
3. On the VPS create the isolated application directory, populate `.env.vps` through a secure server-side transfer, and set permissions 600. Do not paste secret values into chat, CI logs or Git. Preserve existing S3/JWT/LiveKit values. Verify access to the same S3 bucket using read-only checks; do not migrate images to a new bucket during this operation.
4. Load the CI image, set APP_IMAGE to its exact immutable tag, and validate Compose. Start ONLY the new VPS Postgres service. A temporary non-public test DB may be used for rehearsal, but the final restore must use a fresh empty target and must not overwrite any existing unrelated database.
5. Establish **one database writer**: stop/fence ONLY the old PresentStudio backend during the approved window, then make a fresh consistent final `pg_dump -Fc` from its PostgreSQL container. Keep old PostgreSQL running. Validate dump listing/checksum, transfer securely to the VPS and restore into the empty new PresentStudio database. Never rely on the earlier preparation backup for final data.
6. Compare exact table counts and important presentation/slide/media/grant/session records before and after restore. Start ONLY the new backend. Check localhost health, login, dashboard, old decks, slide previews/switching, S3 original/thumbnail access, guest codes, owner/audience roles and LiveKit signaling/audio/screenshare. Initial health success alone is not acceptance.
7. Establish valid TLS and validate/reload the complete proxy configuration only in the approved quiet window. Test direct HTTPS with `curl --resolve connect.snapkeystudio.com:443:200.97.169.48 https://connect.snapkeystudio.com/api/health`. Test WebSocket/Socket.IO and the UI with the same SNI hostname. Do not expose PostgreSQL or the app port publicly.
8. Change ONLY `connect.snapkeystudio.com` to A=200.97.169.48 after readiness. Preserve LiveKit, TURN, Camera Eye and all other records. Reconcile a conflicting CNAME/ALIAS or obsolete AAAA record for this same hostname only. Verify authoritative DNS and multiple resolvers.
9. Keep old app backend stopped/fenced so old DNS caches cannot write to a second database. Cached clients may see downtime until their original TTL expires; use an explicitly reviewed old-endpoint forwarding design if continuity is required. Do not restart the old backend against its old DB while VPS accepts writes.
10. Re-run public tests, verify stored content and live meeting behavior with designated test users, observe errors/resources, then release the maintenance window. Retain old backups and host configuration; do not delete the old project tonight.
11. Merge/update the production source only in the approved window with the manual deploy gate in place. Do not dispatch the legacy AWS workflow after DNS points at the VPS. Configure a separate scoped VPS deployment credential/workflow later; do not upload the root SSH private key as a CI deploy secret. Preserve the old deployment secrets until an explicit reviewed transition is complete.

## Rollback and split-brain protection

Before the VPS has accepted user writes: fence/stop its backend, restore the original Caddy/DNS configuration as appropriate, then resume only the old AWS backend against its unchanged DB. Account for cached DNS; do not let new and old targets both accept writes.

After ANY VPS writes: first stop/fence the VPS writer, take/validate a fresh dump and agree on reconciliation/reverse restore into AWS. Restoring the old pre-cutover backup would lose new data. Do not switch DNS and resume the stale AWS DB without this reconciliation. Never delete either database volume to roll back.

If TLS, S3 access, identity/session continuity, database reconciliation, protected streams or backend checks fail, HOLD the DNS switch and keep the maintenance plan explicit. Do not change other projects to work around a PresentStudio migration failure.

## Command references (maintenance window only)

From the isolated VPS application directory with the prepared files:

```sh
# This validates configuration only; it does not start services.
docker compose --env-file .env.vps -f compose.vps.yml config --quiet
# Start only NEW private PostgreSQL before the final restore:
docker compose --env-file .env.vps -f compose.vps.yml up -d postgres
# After the reviewed final database restore:
docker compose --env-file .env.vps -f compose.vps.yml up -d --no-deps backend
curl --fail http://127.0.0.1:18474/api/health
```

The source includes `backend/app/migrate_slide_images.py` for old embedded images. Run its dry-run only after deployment verification; apply requires a fresh backup and must continue skipping active decks. Do not combine a forced image migration with the database/DNS cutover.
