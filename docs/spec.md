# Tidbytr V1 Spec

Tidbytr is a local TypeScript display server for a stock Tidbyt Gen 2. It renders custom 64x32 WebP panels, selects the next panel with a priority scheduler, and pushes the selected image through the Tidbyt cloud API. V1 deployment includes a Home Assistant OS/Supervised app/add-on package with Ingress and persistent runtime data under `/data`.

Design reference: [tidbytr-dashboard-concept.png](./assets/tidbytr-dashboard-concept.png). The implementation follows its operational dashboard structure while using V1 sources: NWS weather, ESPN-style sports, scheduler status, and display actions.

## Runtime Contract

- Server: Fastify on `TIDBYTR_HOST`/`TIDBYTR_PORT`, default `0.0.0.0:8787`.
- UI: React/Vite build served by Fastify from `dist/web`.
- Persistence: SQLite database at `TIDBYTR_DATA_DIR/tidbytr.sqlite`, default `.tidbytr/tidbytr.sqlite`; Home Assistant sets `TIDBYTR_DATA_DIR=/data`.
- Default installation ID: `tidbytr-main`.
- Display transport: `DisplayTransport` abstraction with `TidbytCloudTransport` posting WebP payloads to `https://api.tidbyt.com/v0/devices/:deviceId/push`.

## API Contract

- `GET /api/status`: current panel, source health, scheduler decisions, last push, display state, sanitized config.
- `GET /api/config`: editable configuration with secrets redacted.
- `PUT /api/config`: validate and persist configuration.
- `GET /api/panels`: panels currently eligible for preview/scheduling.
- `GET /api/panels/:id/preview.webp`: 64x32 WebP preview for a panel.
- `POST /api/actions/push`: render and push a requested or scheduler-selected panel.
- `POST /api/actions/skip`: skip current or requested panel until the next decision.
- `POST /api/actions/snooze`: suppress non-critical panels until a requested time.

## Scheduler Rules

- Always provide a clock baseline panel.
- Panel priority order: NWS warning, NWS watch, live game, NWS advisory, final score, upcoming game, forecast, clock.
- Expired panels are ineligible.
- Snooze suppresses non-critical panels. NWS warning and watch panels may interrupt snooze and quiet hours.
- Quiet hours show only clock unless a critical alert is active or a manual push is requested.
- Manual push can force a specific panel when it exists and has not expired.
- Every decision is persisted with the selected panel, skipped candidates, reason, and result.

## Provider Rules

- NWS provider uses `https://api.weather.gov`, latitude/longitude, and a configured `User-Agent`/contact string.
- NWS provider returns active alerts plus forecast/hourly summary data and marks source health as degraded on fetch or parse failures.
- Sports provider reads favorite-team scoreboard data through a provider interface. The default adapter uses cached ESPN-style public scoreboard endpoints and marks provider failures without failing the scheduler.

## Renderer Rules

- Renderer creates a `FrameBundle` with exactly `64x32` dimensions and a valid WebP buffer.
- V1 panel kinds: calm clock, NWS alert, forecast, upcoming game, live score, final score.
- Rendered panel snapshots are deterministic for fixed input and clock.

## Home Assistant App/Add-On Contract

- Repository root contains `repository.yaml`.
- App/add-on folder is `tidbytr/` with `config.yaml`, `Dockerfile`, `run.sh`, `README.md`, `DOCS.md`, `CHANGELOG.md`, `icon.png`, and `logo.png`.
- `config.yaml` enables Ingress on internal port `8787`.
- Required options: Tidbyt API token, device ID, timezone, latitude, longitude, NWS contact/User-Agent.
- Optional options: favorite teams, log level, scheduler intervals, quiet hours, installation ID.
- `run.sh` reads `/data/options.json`, writes normalized runtime config to `/data/config.json`, and starts Tidbytr with `TIDBYTR_DATA_DIR=/data`.

## Test Mapping

- Scheduler tests cover baseline clock, warning/watch interrupt, advisory rotation, live-game priority, TTL expiry, snooze, quiet hours, and manual push.
- Provider fixture tests cover NWS success/failure and sports success/failure.
- Renderer tests assert dimensions, valid WebP metadata, and deterministic output.
- API tests cover config validation, preview, push/skip/snooze, and status shape.
- Transport tests use a fake Tidbyt API to verify endpoint, token, installation ID, payload, and retry behavior.
- Add-on validation parses `config.yaml`, checks Ingress and `/data` usage, validates required docs/assets, and inspects Docker/run entrypoints.
