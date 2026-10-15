# Security boundary and review notes

## Trust model

The server authenticates the owner against the database, current meeting instance and existing controller socket; presenter share permissions never suffice. A guest binding is issued only to the exact currently admitted guest socket. Bindings use 256-bit random capabilities stored only as SHA256 hashes on the server. Browser sockets send heartbeats every 500ms. The target guest must report ongoing screen sharing. Another guest's identity/meeting ID is not a credential.

A guest-only ticket is 256-bit, expires with the pending 120-second request and is consumed once under an async lock. The helper exchanges it via HTTPS for a distinct capability. The helper must authenticate its WSS connection, show the server-supplied owner identity in its native window, and receive local approval. The browser cannot call approval successfully. A local Windows-session mutex prevents a second helper process. No machine fingerprint or durable machine credential is stored.

Requests are exclusive per bound guest connection and meeting, and each controller socket may assist only one guest at a time. This prevents an owner replacing the control panel while leaving another helper authorized with held input. A second browser on the same physical machine cannot operate a second native helper in the same Windows session. Independent Windows sessions/RDP sessions are outside the tested scope: a session-local mutex is not a device-wide security boundary across user sessions. Do not advertise multi-user Windows-host support.

Request creation is limited to 5/minute per owner binding; pairing attempts to 20/minute per peer IP, with bounded bookkeeping. Input is limited to 120 packets/second/session. JPEG frames are limited to 512KB and approximately 6fps. Configure edge-level IP/connection limits as well, particularly for unauthenticated pair and WebSocket handshakes. Configure trusted forwarded headers correctly; otherwise all guests behind the proxy can share the same rate-limit bucket.

## Input boundary

Owner input must match the session's connected owner SID, valid current meeting and owner privileges, active helper and lease. Sequence numbers must increase exactly by one; a duplicate or skipped critical event closes authorization. Critical events use reliable transport. Mouse moves are coalesced by the browser to at most 40Hz. Values are explicitly validated; only supported virtual keys, left/right buttons, bounded wheel deltas and normalized pointer coordinates are accepted. No shell, clipboard, file access or executable payloads exist in the protocol.

The helper accepts only its compile-time HTTPS origin and normal certificate validation; HTTPS and WSS redirects are disabled. It checks **both** local consent and a fresh server lease before each event. Native monitor dimensions/primary identity are checked; coordinate mapping uses physical pixels across the virtual desktop. Pointer actions are limited to the approved primary display. Key-down requires the foreground window to lie within that display (with a small Windows border allowance). Windows input acts on the foreground application; window changes and complex multi-monitor workflows must be tested. This is not a per-application sandbox.

Windows `SendInput` follows UIPI integrity restrictions. The executable does not request elevation or uiAccess. Secure/non-default input desktops stop the helper. Elevated applications are unsupported; do not bypass Windows policy to make them work.

## Stop and connection loss

Stop Control sets a native atomic cancellation flag; F12 is a local emergency stop not accepted by remote key validation. Native close also cancels. All worker exits/unwinds release tracked held keys/buttons best-effort. Key release cannot be guaranteed after forced process kill, OS termination, secure-desktop transition or input denial; the user may need to release a physically stuck modifier. No future input can be injected by a terminated process.

An explicit browser Socket.IO disconnect immediately ends the associated control session server-side. For silent network failure, browser/helper leases expire after 2 seconds; the native helper's independent server lease expires after 1 second. Expected upper-bound authorization shutdown is therefore roughly 3 seconds plus scheduling/OS delays, not literal zero-time network failure detection. Tests must measure this on real machines. No reconnect can silently restore control; new ticket and native approval are required.

The helper transport uses short read/write timeouts. Native input is executed on its network worker only, behind consent and lease checks. Screen capture/encoding or operating-system scheduling can delay cancellation; do not certify a hard real-time stop guarantee without device tests. The primary implementation remains disabled until these gates are satisfied.

## Persistence and operational constraints

Only metadata transition audit rows persist. Authorization, pair hashes, helper leases and sequence counters are in memory. Restart revokes everything. Exactly one ASGI worker/backend replica is required. Session state is not production-ready for horizontal scaling; a shared revocation broker with authenticated transport is needed first.

The download endpoint serves only a configured file whose SHA256 matches an operator-provisioned release hash. An operator must first use Windows Authenticode verification via the release script; Linux SHA256 checking alone does not prove a signature. No signing certificate or credential is provided by this source tree.

No custom protocol is registered, no executable auto-launch occurs, and no Native Messaging host/Chrome extension is installed. Existing helper users open the portable executable manually. A future optional Chrome extension would still require installing a native messaging host manifest and a Windows registry entry; installing a Web Store extension alone cannot install that native host.

## References

- [Microsoft SendInput and UIPI](https://learn.microsoft.com/windows/win32/api/winuser/nf-winuser-sendinput)
- [LiveKit reliable and lossy data packets](https://docs.livekit.io/transport/data/packets/)
- [Chrome Native Messaging host installation](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)

## Outstanding verification

Compilation, native ABI tests, server unit tests and browser coordinate tests do not replace Windows consent/UI, DPI, actual input and disconnect tests. No penetration test, external security review, bandwidth benchmark, device-wide multi-session exclusion or real-device end-to-end approval is claimed. Keep disabled until reviewed.
