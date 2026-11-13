# Tidbytr add-on operations

## Configuration

Required: `tidbyt_api_token`, `tidbyt_device_id`, `timezone`, `latitude`, `longitude`, and `nws_contact`. Get the key and device ID from the device's settings in the Tidbyt mobile app. Do not put real credentials in Git or screenshots.

Optional: `installation_id` (stable alphanumeric ID, default `tidbytrmain`), `favorite_teams`, `log_level`, `scheduler_interval_seconds`, `refresh_interval_seconds`, and both `quiet_hours_start`/`quiet_hours_end` (`HH:mm`). Empty team lists disable sports. The old default `tidbytr-main` normalizes to `tidbytrmain`.

For standalone development, corresponding environment variables are `TIDBYTR_API_TOKEN`, `TIDBYTR_DEVICE_ID`, `TIDBYTR_INSTALLATION_ID`, `TIDBYTR_TIMEZONE`, `TIDBYTR_LATITUDE`, `TIDBYTR_LONGITUDE`, `TIDBYTR_NWS_CONTACT`, and comma-separated `TIDBYTR_FAVORITE_TEAMS`. Dashboard defaults to port 8787 and data to `.tidbytr`; HA uses `/data`.

## Stock-firmware delivery

Production firmware uses its normal cloud connection. Tidbytr sends base64 WebP to `https://api.tidbyt.com/v0/devices/{deviceId}/push` with bearer authorization and `installationID`. Ordinary scheduled updates use `background: true` to share rotation with Store apps. Manual requests, active manual holds, and critical alerts use `background: false` to request immediate display. These are Tidbyt API semantics also exposed by [Pixlet push](https://github.com/tidbyt/pixlet/blob/v0.34.0/cmd/push.go).

No HDK listener or port 8788 remains. API acceptance is not device telemetry. Tidbytr cannot guarantee physical dwell time, interruption latency, or control over Store apps. Upgrading from HDK requires restoring production firmware; see the root README.

Each push attempt has a 4-second deadline, with up to three attempts and bounded backoff. Network failures, HTTP 429, and HTTP 5xx retry; other HTTP errors do not. Work is checked for supersession/expiry before attempts, and commits are serialized. Already accepted remote requests cannot be recalled. Failed delivery does not advance selection history or overwrite the last accepted local preview. Upstream response bodies and exception details are not exposed as push errors.

## Dashboard and API

The dashboard shows last accepted content, latest push result, a separate selected preview, source health, decisions, and next selection. Status never claims device connectivity from an API response. Config/status omit the token and expose only `apiTokenConfigured`.

- `GET /api/status`, `/api/config`, `/api/panels`: passive cached reads.
- `GET /api/display/current.webp`: passive last accepted local preview, checked against its hash and current device/app target. It never pushes or counts as a device poll.
- `GET /api/panels/:id/preview.webp`: render a preview without uploading it.
- `PUT /api/config`: validate and save settings. Omitted API tokens preserve their existing value. A successful save remains successful if the immediate push fails; inspect latest push status.
- `POST /api/actions/push`: optional `panelId` and `holdSeconds` (20–3600, default 60). Requests immediate display with a selection hold.
- `POST /api/actions/skip`: optional `panelId`, excluded until a replacement is successfully accepted.
- `POST /api/actions/snooze`: `minutes` (1–1440, default 15), clears manual holds and selects clock/critical content.
- `POST /api/actions/source`: `sourceId` and `enabled`. Clock cannot be disabled.

## Priority and freshness

The Screen priorities form edits priority (0–100), cooldown (20–3600 seconds), and minimum selection time (20–120 seconds). Defaults: 20-second minimum, live games repeat after 60 seconds, advisories 120, forecast/upcoming games 300, finals 600. Score/status changes bypass cooldown after minimum dwell. Ordinary waiting candidates gain preference and clock fills gaps. Critical warnings/watches interrupt other Tidbytr content and rotate with concurrent critical alerts, including during snooze/quiet hours. Advisories respect snooze/quiet hours. Server selection history reflects API-accepted selections, not measured device exposure.

Alerts refresh at most every 60 seconds, forecasts at `refresh_interval_seconds`, sports every 30 seconds during live/imminent games or at `refresh_interval_seconds` otherwise. Providers refresh independently of publication. Disabled sources are not queried. Endpoint attempts have 4-second deadlines and one jittered retry; full source refreshes are bounded to 20 seconds.

Forecasts and retained alerts expire within 15 minutes of observation or sooner for expiring alerts. Live scores expire after 90 seconds without a successful observation. Upcoming games are limited to the next 24 hours, with 30-minute observation validity. Finals expire one hour after first observed completion, including restarts. Successful empty alerts clear cancellations. Retained alerts are last-known data, not confirmation they remain active.

Scheduled pushes refresh clock imagery at minute changes. Automatic render failures use a fresh Sharp clock with a degraded reason; failed explicit Show requests return errors. WebP size (512 KiB), dimensions, and decoding are checked before upload. Weather icons animate on two-second loops within their 16x16 area; temperature and labels never move. Unknown conditions remain static.

An uploaded image has no server-enforced device expiry. Cloud/Internet outages or a stopped add-on can leave old images in the rotation. Do not use Tidbytr as the only weather-warning channel.

## Configuration ownership

HA options initialize the baseline; saved dashboard/API options in SQLite override ordinary baseline settings after restart. Missing new fields inherit the baseline. Nonempty HA/environment API credentials and device IDs take precedence at startup so key rotation and migration are not hidden by saved options. Subsequent ordinary setting edits should use the dashboard/API. Intentionally resetting the saved `options` record restores ordinary HA baseline ownership.

Dashboard saves do not rewrite the entrypoint's `config.json`. Quiet hours always come from active configuration. Legacy permanent skip lists clear on migration. Old local frames and pull records do not count as cloud acceptance.

HA persists `/data/config.json`, `/data/tidbytr.sqlite`, and `/data/display/current.webp`. Credential-bearing config and database files have owner-only permissions. API tokens are stored locally to support restarts; keep backups private.

## Release process

Run `pnpm package:addon` after changes to application source, scripts, lockfiles, or package metadata, then commit `tidbytr/source.tar.gz` with the source. GNU tar creates a deterministic source archive for HA's add-on-only Docker context; the build does not download mutable main.

`pnpm verify:release` requires Pixlet v0.34.0, runs typecheck, tests, production builds, and archive freshness verification. CI also builds amd64 and arm64 images. Update both package/add-on versions to make HA offer an update. HA users refresh the Add-on Store, update/rebuild, configure credentials, and restart.

Physical stock Gen 2 validation remains necessary for rotation coexistence, Show now, alerts, animated playback, Internet recovery, and actual latency. The server does not flash device firmware.
