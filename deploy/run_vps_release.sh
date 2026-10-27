#!/usr/bin/env bash
# GitHub-runner transport only. Never changes the server's meeting policy.
set -euo pipefail
: "${RUNNER_TEMP:?}" "${GITHUB_OUTPUT:?}" "${GITHUB_STEP_SUMMARY:?}"
: "${GITHUB_SHA:?}" "${VPS_HOST:?}" "${VPS_PORT:?}" "${VPS_USER:?}" "${ALLOW_ACTIVE:?}"
release_dir="${RELEASE_DIR:-release}"
log_file=$(mktemp "$RUNNER_TEMP/snapkey-deploy.XXXXXX")
trap 'rm -f "$log_file"' EXIT
digest=$(sha256sum "$release_dir/snapkey-studio-image.tar.gz" | cut -d ' ' -f 1)
set +e
cat "$RUNNER_TEMP/snapkey-oidc" "$release_dir/snapkey-studio-image.tar.gz" |
  ssh -T -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=15 \
    -i "$HOME/.ssh/snapkey_ci" -p "$VPS_PORT" "$VPS_USER@$VPS_HOST" \
    "deploy $GITHUB_SHA $digest $ALLOW_ACTIVE" >"$log_file" 2>&1
pipeline_status=("${PIPESTATUS[@]}")
set -e
cat "$log_file"
# Exit 3 alone can also mean a busy deployment lock. Accept only the exact
# server meeting-hold diagnostic; authentication, locks and rollout errors fail.
if [[ "${pipeline_status[1]}" == 3 ]] &&
   grep -Eq '^Deployment held: active meeting participants: [0-9]+$' "$log_file"; then
  echo 'deployed=false' >> "$GITHUB_OUTPUT"
  echo '::notice::Deployment deferred because meetings are active; this run did not deploy.'
  {
    echo '### Deployment deferred'
    echo 'Validation and image preparation completed, but active meetings prevented deployment.'
    echo 'This run did not deploy the release. Retry after meetings end, or use the manual workflow with its explicit meeting override.'
  } >> "$GITHUB_STEP_SUMMARY"
  exit 0
fi
if [[ "${pipeline_status[0]}" != 0 || "${pipeline_status[1]}" != 0 ]]; then
  echo 'deployed=false' >> "$GITHUB_OUTPUT"
  echo '::error::Deployment transport or server rollout failed.'
  exit 1
fi
echo 'deployed=true' >> "$GITHUB_OUTPUT"
