# PresentStudio VPS cutover — 2026-10-15

Status: application and PostgreSQL migration completed. DNS remains with the senior/provider; when last checked it still resolved to the old AWS ALB. The public URL already serves the VPS application through an HTTPS-verified temporary AWS forwarder. No second application/database writer is running.

## Active deployment

- URL: https://connect.snapkeystudio.com
- Primary app/database host: 200.97.169.48, `/srv/snapkey-studio`.
- Compose: `/srv/snapkey-studio/compose.vps.yml`, project `snapkey-vps`.
- Backend `snapkey-vps-backend-1`: `127.0.0.1:18474`, capped at 2 CPU / 4GB.
- PostgreSQL `snapkey-vps-postgres-1`: private Compose network, capped at 1 CPU / 2GB; volume `snapkey-vps_postgres_data`.
- Runtime image: `snapkey-studio:release-bb86f389c0aa777dd0396b45177c991b0895df3d`.
- Image ID: `sha256:1b5b1ec8eaad6e548dd766a41cd6a3d237560dd546456f3b48fefe6c4e1453a8`.
- Image archive SHA256: `3c68255a8d91782515765fd6918900466542872e0f3a0ded2112ea0c038fa506`.
- Exact source: `/srv/snapkey-studio/releases/bb86f38/source`; source archive SHA256 `ac7ad1b87075f037b555d9c12dca248e2bdcd2008de76e7cb8849898b27fbede`.
- Source integration merged: PR #3, main merge `221db7abbce6f28dcaf41907d4717cad6e868b2d`.

JWT-signing, existing S3 and LiveKit credentials were transferred only after the owner's explicit approval, over encrypted SSH, into root-only `/srv/snapkey-studio/.env.vps` (0600). Secret values were never printed. A new random private-database password was generated. Optional old admin, Cloudinary and compute credentials were not copied. Existing admin/user accounts and password hashes are preserved by the database restore.

## Data verification and backups

Stopped ONLY `present-studio-prod-backend-1` on AWS before the final dump. Its PostgreSQL container remains intact for rollback. Source and restored target matched all 13 original tables exactly by row count and content digest before the new application started:

| Table | Rows |
|---|---:|
| users | 15 |
| presentations | 38 |
| slides | 90 |
| media_assets | 182 |
| meetings | 12 |

The new additive remote-control audit table is created by application startup; existing rows were not discarded. Subsequent normal user activity can change counts/digests.

- Final AWS backup: `/srv/projects/present-studio-backups/cutover-20261015-final` (database dump, validated restore listing, application/env archive, previous image ID and forwarder config).
- VPS final transferred dump: `/srv/snapkey-studio/backups/database-final.dump`; SHA256 matched source.
- VPS post-migration snapshot: `/srv/snapkey-studio/backups/database-20261015-180403.dump`, validated with `pg_restore --list` and checksum.
- New timer `snapkey-studio-backup.timer` runs daily around 02:30–02:35 Asia/Kolkata (21:00 UTC plus up to 5 minutes jitter), root-only local dumps, no automatic deletions. `snapkey-studio-backup.service` has low scheduling priority and resource limits. Initial run succeeded.
- This is a local VPS backup, not an offsite backup policy. The immutable final AWS snapshot is retained. Offsite backup destination/retention can be selected separately; no database was uploaded to an image bucket implicitly.

## HTTPS, cached DNS and other services

Caddy-managed HTTPS was successfully issued and is set to renew automatically. The active certificate at completion expires 2027-01-13. Temporary manually loaded bootstrap certificates are not referenced by the active Caddyfile. The app uses HTTP-01 issuance; the temporary AWS forwarder relays ONLY public ACME challenge requests to VPS HTTP, so certificate issuance works even before DNS moves. Ordinary app traffic is forwarded over verified HTTPS with explicit SNI and certificate-chain validation.

AWS `snapkey-cutover-forwarder` listens on the old application port 18473 and forwards to `https://200.97.169.48` with Host/SNI `connect.snapkeystudio.com`. It has no old app process or database connection. CPU cap 0.25, memory 128MB, bounded logs. Old app `present-studio-prod-backend-1` is stopped and must NOT be restarted against its stale DB while the VPS accepts writes.

Existing LiveKit server, Caddy container, Camera Eye portal/databases, n8n and Redis retained their container IDs and start times. Shared Caddy was gracefully reloaded for the additive app route; those containers were not recreated. LiveKit, Camera Eye and n8n health endpoints returned HTTP 200 afterwards. Other project DNS records were not changed.

## Completed verification

- Linux CI image build, isolated runtime health and remote-control-disabled smoke test passed.
- Production integration CI passed: 131 backend tests plus frontend, TypeScript and browser performance checks.
- Restored owner-authenticated dashboard, presentation detail and meeting-list APIs passed on VPS.
- Stored-image/S3 retrieval and S3 bucket access passed.
- LiveKit API room-list access passed from the migrated backend.
- Direct-VPS HTTPS health and login HTML returned HTTP 200.
- Real Engine.IO + Socket.IO WebSocket open/connect/disconnect handshakes passed through direct VPS and public/cached-DNS routes.
- Public URL health returns OK through the forwarder before DNS changes.
- No real two-person microphone/camera/screenshare acceptance or owner-password login was claimed by these programmatic checks. A user should perform a short real meeting test before relying on the next production meeting.
- Remote control remains OFF: the native Windows helper is unsigned and real-device consent/input tests are pending.

## DNS still performed by the senior/provider

Set ONLY `connect.snapkeystudio.com` to A=200.97.169.48, removing a conflicting CNAME/ALIAS for that hostname and checking for an obsolete AAAA if no matching VPS IPv6 is configured. Keep LiveKit, TURN, Camera Eye, root-domain and all other records unchanged.

The DNS change no longer requires another database restore/restart. Existing cached AWS answers continue to work via the temporary forwarder. Verify authoritative DNS and multiple public resolvers after the senior saves the change. Keep the forwarder until propagation and direct access are confirmed; do not delete the old app, old DB, backups or proxy immediately.

Do not resume the stale AWS DB as primary after VPS writes. Any rollback requires first fencing the VPS writer and copying/reconciling current data back to AWS, then coordinated routing. The old pre-cutover dump is not a lossless rollback after new writes.

## Future changes

Production main no longer auto-deploys to the legacy AWS host: merge run 38781775564 passed validation and explicitly skipped `deploy`. The existing manual deploy action STILL points to its legacy configured secrets/path. Do not dispatch it blindly after this migration.

The image workflow builds artifacts without server access and is enabled for main source changes and explicit manual dispatch. A scoped VPS CD credential/workflow is NOT configured; until that is reviewed, deploy verified image artifacts manually only to project `snapkey-vps`, back up first, and recreate only its backend. Never upload the root SSH key as a generic CI secret or run a global Docker/Compose restart/prune.

Read-only checks:

```sh
cd /srv/snapkey-studio
docker compose --env-file .env.vps -f compose.vps.yml ps
curl --fail http://127.0.0.1:18474/api/health
systemctl list-timers snapkey-studio-backup.timer
journalctl -u snapkey-studio-backup.service -n 20 --no-pager
```

Older-deck embedded-image migration remains a separate controlled operation; retain live-deck protection and a fresh backup. Do not force-clear live flags merely to migrate images.
