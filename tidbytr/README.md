# Tidbytr

Tidbytr runs a local dashboard and scheduler for a stock Tidbyt Gen 2 running HDK firmware. It renders 64x32 WebP panels for clock, NWS weather alerts/forecast, and favorite-team sports scores, then publishes the selected panel at `/current.webp` for the device to poll.

Open the dashboard through Home Assistant Ingress after installing the add-on. Runtime data, config, cache, scheduler history, and SQLite state are stored in `/data`.

Set `display_base_url` to the add-on LAN address, usually `http://homeassistant.local:8788` or `http://<ha-ip>:8788`, then flash/configure HDK with `${display_base_url}/current.webp`. Do not use the Home Assistant Ingress URL for firmware polling.

V1 does not create Home Assistant entities. Status and actions live inside the Tidbytr dashboard.
