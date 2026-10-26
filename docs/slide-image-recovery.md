# Slide image persistence recovery and deployment checklist

## Why old images disappeared

The editor used to save a Fabric canvas after rebuilding it asynchronously. If a persisted image failed to load, Fabric could return a canvas missing that image. The next autosave then replaced the original saved slide JSON with the incomplete canvas. Overlapping requests and stale browser tabs could overwrite newer data as well. Do not confuse this with a transient viewer-side loading delay.

## Before deploying

1. **Stop simultaneous edits** to affected presentations and capture a PostgreSQL database backup plus S3 versioning/backup information. Do not restore in production without a backup.
2. Identify the production Git SHA; check if it includes these commits before altering anything.
3. Run JavaScript regression checks: `node --test tests/slide-image-persistence.test.cjs`.
4. Run backend tests with existing test configuration and browser smoke tests.
5. In a staging instance reproduce: missing S3 image, delayed image load, rapid slide switching, concurrent saves from two tabs and different devices, duplicate images, and explicit intentional deletion. Confirm no unexpected objects disappear.
6. Verify `presentation_snapshots` table exists after migration/startup and that old JSON is captured before each successful save.
7. Verify `409` on stale saves and that the UI reports a conflict instead of claiming "Saved".
8. Verify preview and live audience update performance using large multi-image decks.
9. Release staging first; monitor 409s, image restore failures, and save durations.

## Read-only audit on the trusted backend server

```bash
PYTHONPATH=backend python tools/audit_presentation_media.py --presentation-id YOUR_PRESENTATION_ID
```

The audit compares current image IDs with up to 30 *newly recorded* snapshot versions. An image absent from the current slide but present in an older snapshot is only a **candidate**, since the owner might have intentionally deleted it.

For a missing image that predates snapshot deployment, inspect older PostgreSQL backups, database snapshots or archived slide exports. S3 media objects alone cannot reconstruct exact slide coordinates if the old canvas JSON is gone.

## Explicit owner-controlled restore

After manually reviewing a candidate snapshot, use authenticated endpoints:

- `GET /api/presentations/{id}/snapshots` lists per-slide image counts
- `GET /api/presentations/{id}/snapshots/{snapshot_id}` retrieves archived JSON for review
- `POST /api/presentations/{id}/snapshots/{snapshot_id}/restore-images`
  with JSON `{"slideId":"...", "baseUpdatedAt":"the-current-presentation-updatedAt"}`.

This **adds missing image objects only** for one slide and retains current non-image edits. The restore rejects stale revisions. Never automatically restore candidates without the owner's review.

## Limits

- The new snapshot history only begins after this version is deployed.
- Screenshots, published PNG previews and existing S3 objects are not equivalent to original slide placement JSON.
- This branch has not been production-tested or signed off for immediate deployment.
- Retain independent database backups; an in-database snapshot journal is not a substitute for disaster recovery.
