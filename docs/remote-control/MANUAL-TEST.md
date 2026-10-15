# Two-computer Windows integration acceptance plan

Do not run against the active production server until deployment is separately approved. Use an isolated staging backend/database with the existing meeting UI/LiveKit configuration and a trusted HTTPS hostname. Do not reuse a live production database for testing.

## Prepare

1. Reconcile this repository base with production fixes before any deployment decision. Review all changes and take a staging database backup. Apply the additive audit migration, use exactly one backend worker/replica and enable the feature only on staging with `REMOTE_CONTROL_ENABLED=true`.
2. Build the x64 helper on a Windows build machine using `remote-assist/scripts/build.ps1 -TrustedOrigin https://YOUR-APPROVED-STAGING-HOST`. Use a real valid TLS certificate for that hostname. Do not disable TLS validation. The helper pins its allowed origin at compile time.
3. For guest download testing, Authenticode-sign the binary, verify with `Get-AuthenticodeSignature`, run `verify-release.ps1`, mount the verified release read-only, and set its SHA256 in `REMOTE_ASSIST_SHA256`. An unsigned CI artifact is a development artifact and must not be published to users.
4. Computer A: Windows owner browser, authenticated as the actual meeting owner. Computer B: Windows guest browser/helper, standard user, on another network (for example mobile hotspot). No router forwarding or extension is needed. Both need outbound HTTPS/WSS and the existing LiveKit media connectivity.

## Happy path

1. A starts a fresh meeting; B joins through the ordinary guest link and completes admission/password as required.
2. Both join audio/video. B shares the primary display. Verify normal LiveKit video, screen audio if enabled, chat and slide controls before testing remote input.
3. A clicks Request Control on B's screen tile. A sees Waiting for Audience; B sees the named owner's request. Verify no input moves B's cursor yet.
4. B clicks Prepare Helper Pairing. Copy the short-lived pairing text, download the signed helper if needed, and manually open it through normal browser/Windows prompts. The meeting must stay active.
5. B pastes the pairing text into the helper and clicks Connect. Verify the native dialog names A correctly and asks to approve the whole primary display. A sees Waiting for Approval. No input is allowed yet.
6. B checks the primary-display consent box and clicks Allow Control. A sees Controlling and the helper preview appears in the meeting overlay. Verify the preview matches B's primary monitor, even if the browser originally shared another source.
7. A focuses the preview, moves/clicks the cursor, right-clicks, scrolls, types A-Z/0-9, tests Shift/Ctrl and arrow keys in Notepad. Test Fullscreen and Escape release. Unsupported punctuation/IME/system shortcuts are outside this first version; verify they do not produce unintended events.
8. Verify ongoing audio/video/chat/presentation synchronization in both directions. Compare CPU/network use with remote assistance disabled.

## Optional Open Helper onboarding

While the helper is idle, explicitly enable Open Helper links in its native window. Close it. On a fresh guest request, click Studio Open Helper, accept the normal browser/OS confirmation, and verify only the trusted-origin pairing text is prefilled. Connect and Allow Control must still be explicit. Remove registration using the idle native button and verify manual opening/pasting continues to work. Moving/deleting the portable executable invalidates the registered path; re-enable from its new location. If it is already running, use its existing window rather than opening a second instance.

## Stop and authorization failures (repeat with a fresh ticket each time)

- B denies in-browser: A sees Control Denied; old ticket/helper cannot obtain control.
- B clicks native Stop or presses physical F12: input stops; fresh native approval is required to resume.
- B closes the helper; kills it in Task Manager; or disconnects its network. Measure stop latency and manually check for stuck modifiers after forced kill. No further input may execute.
- A releases, closes the meeting tab, backgrounds the tab, closes the browser or loses network. Explicit disconnect should revoke promptly; silent connection failure must expire through the lease. Measure against the documented approximate 3-second failure-detection budget.
- B stops sharing, leaves the meeting, is removed, or the owner ends the meeting. Control must not survive.
- Reuse a consumed/expired ticket; edit the trusted hostname; use another guest's sessionId; submit a duplicate input sequence; submit input before approval/after revoke. All must fail closed.
- Have another guest/co-host request control or approve through HTTP. Both must be rejected. A presenter share URL is insufficient.
- Two owners/tabs issue simultaneous requests for B. One pending session maximum. Start two helper executables: the second must refuse within the same Windows session.
- End the meeting, then start a new instance on the same presentation. Old requests must not authorize the new instance.

## Display and Windows boundaries

- Repeat at 100%, 125%, 150% and 200% scaling, mixed-DPI monitors and portrait primary display. Click all four corners and center; letterbox/pillarbox regions must not inject input.
- Change resolution, change primary monitor, connect/disconnect a monitor or rotate the display during control. Require new consent; never silently map input to another monitor.
- Move local cursor/focus to another monitor. Input outside approved display must terminate rather than act there.
- Open an elevated application or UAC/lock screen. Verify no elevation bypass and fail-closed behavior. Return to normal desktop and require a new request.
- Test slow/high-latency networks and background-tab throttling. Early revocation is acceptable; continued unauthorized input is not.

## Acceptance record

Record OS/browser versions, helper SHA256/signature identity, server commit/configuration, network type, monitor layout/scaling, each case's result, measured revocation delay and CPU/network observations. Do not record sensitive keystrokes/screenshots. Keep feature disabled if any consent, mapping, stop or cross-meeting test fails.

No real-device results have been recorded by this implementation session.
