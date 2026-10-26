# Automatic VPS deployments

Push or merge application changes to `main` in
`koushikdatascience-netizen/Present-Studio` (your accessible repository), or
`MadhushalaReport/SnapkeyStudio`. Both are authorized to deploy the same app.
GitHub Actions runs backend, frontend,
TypeScript and browser regressions, builds and smoke-tests a release image, then
deploys it to the current VPS. Feature branches and pull requests run checks
without deploying. The desktop app and this computer are not required.

Use a web coding agent with write access to this repository to make changes and
open/merge pull requests. A connection that only reads GitHub cannot push code.
Successful merge-to-main deployment appears under **Deploy SnapKey Studio** in
GitHub Actions. A failed validation never reaches the deployment job.

Automatic deployment holds if PresentStudio meetings have participants. Once
meetings finish, rerun the workflow on `main` from GitHub or ask a connected
coding agent to dispatch it. A manual dispatch can explicitly enable
`allow_active_meetings`; this temporarily interrupts slide/control connections.
There is no recurring Codex monitor or midnight deployment for this setup.

The workflow creates a fresh validated database backup and recreates only the
`snapkey-vps` backend. It preserves the existing environment/Compose settings,
checks application health, and restores the previous image on initial failure.
PostgreSQL, LiveKit, Caddy, Camera Eye, n8n and Redis are not restarted. Existing
presentations are not migrated automatically. Already-open pages should reload
after an application release.

## Deployment access

GitHub stores `VPS_DEPLOY_KEY` and `VPS_KNOWN_HOSTS` as Actions secrets. This is a
dedicated key, not the administrator key. Its VPS authorized-key entry forces
the root-owned `/usr/local/sbin/snapkey-studio-ci` command and disables SSH
forwarding, PTYs, and arbitrary shell/SFTP commands.

The server also verifies a short-lived, signed GitHub OIDC token: repository and
owner IDs, repository name, `main`, exact commit, hosted runner, event type and
`.github/workflows/deploy.yml` must match. A copied deploy key alone cannot deploy
from another branch or repository. Meeting overrides require a manually
dispatched workflow. Tokens and production environment values are not printed. Signature verification
runs in an isolated, credential-free verifier image pinned by a root-owned file,
independent of the live app filesystem and its changing dependencies.

The server helper is installed from `deploy/vps_ci.py`; it accepts only validated
release IDs and archives, checks archive SHA-256 and image revision, limits
archive size, serializes deployments with a host lock, and never accepts a user
supplied path, Compose option or shell command. Updates to this root-owned
helper require administrator installation; ordinary application changes do not.

Legacy `SERVER_*` secrets are retained for recovery, but the deployment workflow
no longer uses the old AWS host or source-copy/reset commands. Builds happen on
GitHub runners, not on the live application server.
