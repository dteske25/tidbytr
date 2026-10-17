# Tidbytr Add-On Docs

## Required Options

- `timezone`: IANA timezone for schedule decisions.
- `latitude` and `longitude`: home location for NWS forecast and alerts.
- `nws_contact`: contact string used as the NWS User-Agent.

## Optional Options

- `favorite_teams`: team abbreviations or display names to track through the sports provider.
- `scheduler_interval_seconds`: decision cadence.
- `refresh_interval_seconds`: provider refresh cadence.
- `quiet_hours_start` and `quiet_hours_end`: `HH:mm` quiet window. Critical NWS alerts may interrupt.
- `display_base_url`: LAN URL for the read-only display feed, usually `http://homeassistant.local:8788` or `http://<ha-ip>:8788`.

## HDK Display Feed

Configure HDK to poll `${display_base_url}/current.webp`. The add-on exposes this read-only WebP feed on port `8788`; the Home Assistant Ingress URL is only for the dashboard and should not be used by firmware.

## Dashboard

The Ingress dashboard shows current panel preview, source health, scheduler history, last publish state, last firmware pull, Show now, skip, snooze, and source enable/disable controls.

## Persistence

The add-on writes normalized runtime config to `/data/config.json`, the current WebP to `/data/display/current.webp`, and SQLite state to `/data/tidbytr.sqlite`.

## Priority screen rules (0.5)

The dashboard's Screen priorities form edits priorities (0–100), repeat cooldowns (20–3600 seconds), and minimum dwell time (20–120 seconds). Defaults hold screens for 20 seconds. Unchanged live games repeat after 60 seconds, advisories after 120, forecasts/upcoming games after 300, and finals after 600. Score/status changes may bypass cooldown after minimum dwell. Waiting ordinary candidates gain preference; clock fills gaps. Critical warnings/watches interrupt ordinary content and share time across concurrent alerts, including during quiet hours/snooze. Advisories respect quiet hours/snooze. The alert priority preserves the warning/watch/advisory offsets.

Show now requests a one-minute hold; critical alerts retain precedence. Skip excludes a panel until one replacement is successfully published. Snooze clears manual holds and immediately selects clock/critical alerts. Clock cannot be disabled. The API accepts `holdSeconds` (20–3600) with `POST /api/actions/push`. `PUT /api/config` accepts `screenPolicy` containing `minimumDwellSeconds`, `priorities`, and `cooldownSeconds`; kind keys are `clock`, `nws-alert`, `forecast`, `upcoming-game`, `live-score`, and `final-score`.

## Refresh and freshness

Dashboard reads use cached snapshots. Alerts refresh at most every 60 seconds, forecasts at `refresh_interval_seconds`, and sports every 30 seconds during live/imminent games or at `refresh_interval_seconds` otherwise. Disabled sources are not fetched. Each endpoint gets a 4-second attempt deadline and one jittered retry; a full provider refresh is bounded to 20 seconds. Display selection never waits for provider refreshes.

Forecasts and retained alerts expire within 15 minutes of successful observation, or sooner for expiring alerts. Live scores expire after 90 seconds without a successful observation. Upcoming screens are limited to games within 24 hours and expire after 30 minutes without refresh. Finals expire one hour after first observed completion, including across restarts. Successful empty alerts clear cancellations; retained warnings during an outage are last-known data, not confirmation they remain active.

Firmware pulls check frame validity and content hashes, regenerate expired/mismatched frames, and refresh clock imagery at minute changes. Automatic render failure publishes a fresh Sharp clock with an observable degraded reason; a failed explicit Show request returns an error. `GET /api/display/current.webp` returns the last published bytes for dashboard monitoring without recording a firmware pull. Status distinguishes published content, the next candidate/reason, freshness, and source observation timestamps. Polling is not proof of physical decoding/display.

## Configuration ownership

HA options initialize the baseline. Once a dashboard/API save is made, complete options saved in SQLite override that baseline on restart. Make subsequent edits through the dashboard/API; intentionally resetting the saved `options` record restores the HA baseline. Dashboard saves do not rewrite the entrypoint's `config.json`. Quiet hours always come from active configuration. Legacy permanent skip lists are cleared during migration.

## Building and device validation

Run `pnpm package:addon` after editing application sources, scripts, lockfiles, or package metadata and include `tidbytr/source.tar.gz` in the release. Packaging requires GNU tar. The deterministic bundle supports HA's add-on-only build context without downloading mutable main or requiring release tags. `pnpm verify:release` requires Pixlet 0.34.0, runs typecheck/tests/build, and rejects stale bundles. CI builds amd64 and arm64 images.

Physical Gen 2 testing remains necessary for AP reconnection, Internet loss, HA restart, animation interruption, and actual latency. This server does not flash or modify HDK firmware.
