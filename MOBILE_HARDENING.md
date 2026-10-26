# Mobile Meeting Hardening

Source snapshot: `saumyasinghabm-gif/present-studio@c6776e88ad48ddbe47479e5defea10bb01a73b78`

This repository is an isolated copy of Present Studio plus mobile meeting hardening.

## Applied protections

- Stable browser/device meeting identity.
- Stable room-scoped LiveKit participant identity as a server-side duplicate-tab safety net.
- One active meeting tab per presentation/role, with explicit takeover.
- Screen Wake Lock while connected when supported.
- Microphone desired-state tracking.
- Microphone health checks and recovery after mobile background/foreground interruptions.
- Forced iOS/iPadOS microphone track restart after a meaningful interruption.
- Remote audio playback recovery after foregrounding.
- Recovery on visibility, pageshow, focus, online, and LiveKit reconnect events.
- Media-device error reporting.
- Regression tests for deterministic LiveKit participant identity.
- Cache-busted live-media client references.

## CI/CD safety

The original deployment workflow is preserved at:

`.github/workflows-disabled/deploy.yml`

It is intentionally outside `.github/workflows/`, so this isolated repository will not automatically deploy to the existing production server.

## Release gate

Before reconnecting CI/CD, test:

1. iPhone Safari: join, mic, mute/unmute, app switch, lock/unlock recovery, AirPods/Bluetooth.
2. Android Chrome: wake lock, app switch, lock/unlock recovery, battery saver.
3. Same audience meeting in 2+ tabs: only one active audio session and explicit takeover works.
4. Wi-Fi/mobile-data interruption and reconnect.
5. Desktop controller/admission/co-host/screen-share/recording regression.

A browser cannot guarantee indefinite microphone transmission while the operating system deliberately keeps the phone locked/backgrounded. That requirement still needs a native mobile calling client.
