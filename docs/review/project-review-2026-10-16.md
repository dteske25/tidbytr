# Tidbytr priority and reliability review

Historical findings from version 0.4.0, commit `5131fe0`, reviewed October 16, 2026. See [implementation notes](implementation-0.5.md) and [operational documentation](../../tidbytr/DOCS.md) for the remediation.

The architecture can provide more useful priority-driven screens, but no production Store comparison or physical-device telemetry establishes superior reliability yet. Invest in coordinated scheduling and failure recovery before adding independent apps. Providers/renderers are reusable if delivery later moves back to a cloud app.

## Main findings

1. **Source I/O blocks display selection.** The runtime awaits both providers before any publish; fetches lack application deadlines. A hung endpoint can freeze clock refresh and cold-start display requests.
2. **Unrelated provider failures discard useful data.** NWS combines alerts and forecast with `Promise.all`, so forecast failure discards a successful warning. Sports similarly combines four leagues into one all-or-nothing result.
3. **Highest-priority selection starves other screens.** Sorting priorities and repeatedly taking the first candidate provides neither dwell/cooldown rules nor fairness. Forecast beats clock indefinitely; live games and equal-priority events can monopolize the display. The test named “rotates advisory…” only checks priority comparisons.
4. **Overlapping publication races can hide warnings.** Only timer calls have a running guard. A delayed forecast render can overwrite a later warning published by a manual action or another request. Atomic rename protects bytes, not ordering; PID/millisecond temp names can also collide.
5. **Freshness is not enforced on served images.** A retained frame is served without panel expiry checks. A day-old clock or alert can be served while polling marks the display online. Rebuilding panels also renews game/forecast validity without preserving source observation time; finals gain another hour indefinitely.
6. **All NWS alerts incorrectly count as critical.** Advisory panels explicitly have `critical: false`, but the selector also treats the entire alert kind as critical, bypassing snooze and quiet hours.
7. **Skip never expires.** A persisted set accumulates skipped stable IDs across decisions and restarts. Skip, snooze, and source toggles do not immediately republish, and disabled sources are still queried.
8. **Configuration has competing owners.** Saved scheduler state retains an old quiet-hours copy after configuration changes. The entrypoint rewrites JSON from HA options while the runtime restores SQLite options only when a store is injected; restart behavior differs between production and tests.
9. **Dashboard monitoring changes state and workload.** Status reselects and overwrites the current-panel field without publishing. Status, panels, and preview independently query NWS, producing nine upstream requests per normal dashboard cycle. The configured refresh cadence is unused. Frontend actions ignore HTTP failures.
10. **Release verification misses deployed behavior.** Docker downloads mutable main rather than the reviewed checkout. Five real Pixlet tests are skipped when Pixlet is absent. With Docker-pinned Pixlet 0.34.0 installed, the clock layout test fails. Supported panel renderer failures do not automatically use a fallback renderer.

The strengths are a pure selector, injected provider/renderer interfaces, normalized panels, atomic publication, a separate read-only display listener, and persisted decision history. These provide a useful basis for remediation.

## Product direction

Separate eligibility, urgency, and screen time. Critical active weather should interrupt ordinary content and share time among concurrent alerts. Changed sports scores deserve another showing; unchanged games should cool down. Upcoming games should have a lead-time window; finals should have an anchored expiry. Forecasts/advisories should get brief showings with limited repeats, while clock fills unused time. Keep manual holds explicit and expiring.

The local HDK path controls one polled image and removes cloud delivery dependence, but adds HA/LAN/firmware ownership. Upstream HDK polls roughly every ten seconds and applies updates between animations. Its Wi-Fi handler stops initiating reconnect attempts after ten failures. These source observations are not validation of the user's installed firmware. A cloud-delivered server-selected app is another possible transport: Pixlet supports immediate pushes and installation IDs, but that retains cloud dependencies and does not prove control over other installed apps.

## Validation gate

Use deterministic multi-hour selection timelines, failure fixtures, concurrent-publication tests, real Pixlet rendering, and architecture-specific container builds. Then run a 7–14 day comparison on actual devices, including Internet loss, AP restart/long disconnect, HA restart, provider failures, renderer errors, and stale data. Record stale/blank minutes, critical-event latency, recovery time, missed changes, and manual interventions. Measure source detection, publication, poll latency, and physical display separately.

Sources inspected: [HDK](https://github.com/tidbyt/hdk), [Wi-Fi recovery](https://github.com/tidbyt/hdk/blob/main/src/wifi.c), [main polling loop](https://github.com/tidbyt/hdk/blob/main/src/main.c), [graphics loop](https://github.com/tidbyt/hdk/blob/main/src/gfx.c), and [Pixlet 0.34.0 push](https://github.com/tidbyt/pixlet/blob/v0.34.0/cmd/push.go).
