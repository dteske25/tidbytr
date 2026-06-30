# Tidbytr Add-On Docs

## Required Options

- `tidbyt_api_token`: Tidbyt API bearer token.
- `tidbyt_device_id`: Tidbyt device ID.
- `timezone`: IANA timezone for schedule decisions.
- `latitude` and `longitude`: home location for NWS forecast and alerts.
- `nws_contact`: contact string used as the NWS User-Agent.

## Optional Options

- `favorite_teams`: team abbreviations or display names to track through the sports provider.
- `scheduler_interval_seconds`: decision cadence.
- `refresh_interval_seconds`: provider refresh cadence.
- `quiet_hours_start` and `quiet_hours_end`: `HH:mm` quiet window. Critical NWS alerts may interrupt.
- `installation_id`: Tidbyt installation ID. Must be alphanumeric. Defaults to `tidbytrmain`.

## Dashboard

The Ingress dashboard shows current panel preview, source health, scheduler history, last push state, push now, skip, snooze, and source enable/disable controls.

## Persistence

The add-on writes normalized runtime config to `/data/config.json` and SQLite state to `/data/tidbytr.sqlite`.
