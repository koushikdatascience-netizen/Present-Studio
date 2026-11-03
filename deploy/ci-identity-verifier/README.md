# GitHub deployment identity verifier image

This small image is the isolated runtime used by `deploy/vps_ci.py` to validate
GitHub Actions OIDC signatures and deployment claims. It contains only pinned
Python, PyJWT, and cryptography dependencies; it does not contain application
code or production credentials. The verifier code is supplied at runtime by the
root-owned deployment helper.

The Python base image is pinned to its Linux AMD64 manifest digest. The release
workflow builds and smoke-checks the image, exports it as
`ci-identity-verifier.tar.gz`, and records the resulting immutable image ID in
`ci-identity-image.txt`, covered by `SHA256SUMS`.

To restore a missing image on the VPS, verify the artifact checksum, load the
image, confirm that `docker image inspect` returns the recorded image ID, then
atomically install that ID in `/srv/snapkey-studio/ci-identity-image` with
root ownership and mode `0600`. Do not replace the signature checks or select a
different image digest without reviewing this source and the GitHub release
artifact.
