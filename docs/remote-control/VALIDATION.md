# Validation record — 2026-10-15

Base: `1a6472d4fc2008be48eb9b709b06ca6830eeab57` from the requested Present-Studio repository. Isolated feature branch; no production merge/deployment.

- New authorization tests: **33 passed** locally. Includes admitted owner request, unauthorized guest/owner rejection, denial, native-channel approval, expiration, consumed-ticket replay, concurrent request exclusion, cross-meeting isolation, pre-consent/post-revoke input rejection, owner/guest presence expiry, helper socket closure, invalid input, sequence replay, concurrent input order, rate limiting, disabled-feature gate, screen-share end, meeting end, owner privilege revocation and unavailable signed download.
- New frontend tests: **4 passed**. Landscape/portrait letterbox mapping and both HTTP/socket ordering cases for pairing text.
- Frontend JavaScript syntax checks passed for remote-control.js and modified live-media.js.
- Full backend run at the first feature implementation: **110 passed, 6 failed**. All six failures are the existing media/YouTube Open Graph preview assertions. Running unchanged baseline's media-storage suite reproduced the same six failures (3 passed, 6 failed). Remote assistance did not modify the preview handlers.
- Full frontend run: **65 passed, 6 failed** before adding the two pairing race tests. Unchanged baseline: **63 passed, 6 failed**, matching failure names: co-host demotion, three gallery assertions, preview-whiteboard stopLoop, missing mathjs test dependency. Normal Node test-process isolation was used with sandbox escalation; an initial sandbox-only run failed with spawn EPERM and is not counted as a product failure.
- First GitHub feature CI run: https://github.com/koushikdatascience-netizen/Present-Studio/actions/runs/38700676499 — passed backend authorization and frontend mapping tests, Windows native ABI test and Windows release compilation at commit `3205ed2`.
- Initial unsigned development artifact: 7,402,496-byte executable downloaded to `D:/SocialSyncV1/tmp/remote-assist-build-3205ed2/target/x86_64-pc-windows-msvc/release/snapkey-remote-assist.exe`. Not executed, signed, installed or deployed. Later source hardening requires a fresh matching build; do not distribute this earlier artifact as the final release.
- CI-generated Cargo.lock is committed for locked dependency resolution. Rust toolchain is pinned to 1.93.0; build scripts use --locked.

Final build revision/results will be appended after feature CI completes. No real Windows-to-Windows control, display DPI, stop latency, signing or production integration test is claimed.


Final local regression rerun before the single-controller-session guard: **115 backend tests passed, the same 6 preview tests failed**; **67 frontend tests passed, the same 6 baseline tests failed**. The additional guard has a focused passing test.
