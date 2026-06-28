# Tidbytr

Tidbytr runs a local dashboard and scheduler for a stock Tidbyt Gen 2. It renders 64x32 WebP panels for clock, NWS weather alerts/forecast, and favorite-team sports scores, then pushes the selected panel through the Tidbyt cloud API.

Open the dashboard through Home Assistant Ingress after installing the add-on. Runtime data, config, cache, scheduler history, and SQLite state are stored in `/data`.

V1 does not create Home Assistant entities. Status and actions live inside the Tidbytr dashboard.
