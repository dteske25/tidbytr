# Version 0.5 implementation

This delivers the software milestone from the [review](project-review-2026-10-16.md), without claiming measured superiority over Store apps.

- Independent, cached provider jobs have deadlines, bounded retries, in-flight sharing, observation timestamps, and adaptive refresh intervals. Forecasts/alerts and sports leagues fail independently.
- Priorities, dwell time, cooldowns, meaningful score/status changes, and display history determine screen exposure. Ordinary content shares time; critical alerts interrupt and share time with concurrent critical events. Clock fills unused time.
- Controls immediately reselect. Skips are consumed after a successful replacement, manual holds expire, advisories respect quiet/snooze policy, and clock cannot be disabled.
- Publication uses generations and serialized commits to reject obsolete work. WebP dimensions, decoding, size, persisted validity, and frame hashes are checked. Automatic rendering failures produce a fresh degraded clock.
- Monitoring separates published frames, previews, next candidates, freshness, and recent polls. Dashboard reads do not query providers or count as device pulls.
- SQLite dashboard options override the HA baseline consistently on restart. Quiet hours come from active configuration, independently of scheduler state.
- A deterministic source bundle lets HA build the reviewed checkout without downloading mutable main. Release verification requires actual Pixlet tests and rejects stale bundles; CI also builds amd64 and arm64.

## Verification

The restored implementation passes typecheck, 64 tests including actual Pixlet 0.34.0 integration, production builds, and source-bundle freshness checks. Regression cases cover source hangs, partial failures, stale/corrupt frames, obsolete render ordering, manual/background races, immediate actions, restart settings, alert precedence, and busy multi-kind scheduling timelines. Clock layout assertions pass without weakening thresholds.

The prior workspace run also completed an amd64 container build, offline startup/display smoke, and Chromium desktop/mobile action and layout checks. That workspace was reset before committing; application code and tests were restored from the chat record and the release verification was rerun before publication. Container and browser checks from that earlier run are historical evidence, not a new physical-device trial.

## Remaining validation

Run the amd64/arm64 CI matrix, exercise the actual installed Gen 2 after short and long AP outages, measure physical interruption/animation latency, and perform the 7–14 day Store/cloud/local comparison. No firmware has been changed or flashed. Local server fallback cannot repair device Wi-Fi retry exhaustion.
