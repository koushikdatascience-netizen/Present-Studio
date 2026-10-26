# Review fixes — 26 October 2026

Concurrent editor saves now require the loaded deck's `updatedAt` version. The
server rejects stale versions before uploading embedded images or changing
slides. The editor retains conflicted work and provides an unsaved JSON download.
No database schema change is required.

Live presentation updates send changed slides and ordering instead of the entire
deck. Audience, controller and screen clients apply updates in order and recover
missed updates through their authorized fetch paths, including on reconnect.
Deploy frontend and backend together and reload already-open old pages.

Remote assistance now distinguishes helper heartbeat expiry, invalid input,
input rate limits, failed delivery, malformed helper messages, explicit browser
release/denial, and browser disconnects. Failed delivery returns an error rather
than reporting success. Consent and input restrictions remain in force.

Existing embedded images still need the documented backed-up migration after
deployment, or a successful save using S3. Live decks remain protected from the
migration. This code change does not modify any production data or deploy itself.

Real Windows-to-Windows remote-control behavior and performance with 3–5 real
meetings remain release checks requiring the actual devices and environment.
Automated tests do not establish that those checks passed.
