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
