# Presentation loading improvements

The production audit found about 34 MB of slide canvas JSON, almost entirely
embedded raster images. Loading all decks, saving complete decks and broadcasting
those images to every viewer made that data repeat across requests.

## Behavior

- The dashboard requests owner-scoped, paginated summaries with total counts and
  one lightweight cover. Existing full-deck endpoints keep their response shape.
- Presentation cards render independently of meetings. The editor renders
  independently of the media library.
- Dashboard cover canvases are 320×180 and render near the viewport. Sidebar
  previews reuse unchanged DOM. Adjacent image prefetching is bounded to 16 URLs.
- Pasted images use the normal upload path. Saving old embedded PNG/JPEG/WebP/GIF
  images on S3 creates immutable assets plus small WebP previews, deduplicated per
  owner, while preserving original image bytes and scene metadata. Storage quotas
  apply. Failure leaves the saved slides unchanged. Other formats/storage providers
  keep their existing representation.
- Persistence uses its own session in a worker thread and updates existing slide
  rows rather than deleting/reinserting the whole deck. Socket.IO's existing full
  update event remains compatible with connected clients; once images are URLs,
  those updates no longer contain the image binaries.
- Slow saves cannot overwrite newer local edits. Images decoding after navigation
  cannot replace the selected slide; an upload finishing after navigation targets
  its original slide.
- Immutable media redirects use a private browser cache for at most five minutes,
  bounded below the signed URL expiry. No public cache for private deck JSON is
  introduced. Stable object IDs are not reused for different image contents.

## Deployment and existing images

Branch pushes run backend, frontend, TypeScript and actual browser regressions.
The main-branch deployment now requires those checks and recreates only the
backend, leaving its database service running. A backend restart still reconnects
active sockets; deploy during a quiet window. This is not a zero-downtime rollout.

No automatic data migration runs at startup. To inspect existing idle decks:

```sh
docker exec present-studio-prod-backend-1 python -m app.migrate_slide_images
```

To migrate a selected idle deck after validating the deployment:

```sh
docker exec present-studio-prod-backend-1 python -m app.migrate_slide_images \
  --presentation-id PRESENTATION_ID --apply --backup /tmp/slide-images-backup.json
docker cp present-studio-prod-backend-1:/tmp/slide-images-backup.json \
  /srv/projects/present-studio-backups/slide-images-backup.json
```

Use a unique backup filename each time. Keep recovery files out of Git and preserve
them outside the container before any restart. The migration refuses to overwrite
its backup, skips live sessions, and skips decks edited after the backup snapshot.
Take the normal database backup first as well. Existing idle decks benefit after
migration; old open clients benefit when they reload. Live decks can be migrated
after the meeting ends. The migration does not emit events to existing meetings.

## Verification

Tests cover owner isolation, bounded summaries, image deduplication and quotas,
storage-failure rollback, immutable caching, retained live state/event contracts,
and dry-run/backup/live-session protection. Browser checks delay meeting/media
requests, switch slides during image decoding and upload, and edit during a slow
save. Peak-load timing with 3–5 real meetings remains a production verification
step; unit/browser checks do not establish a particular speedup under that load.

This branch also reconciles already-deployed recording, media-error guidance,
canonical sharing and styling changes that were absent from the deployment repo,
so the next deployment preserves the verified running application.
