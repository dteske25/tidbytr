# Tidbytr add-on operations

## Configuration

Required: `tidbyt_api_token`, `tidbyt_device_id`, `timezone`, `latitude`, `longitude`, and `nws_contact`. Get the key and device ID from the device's settings in the Tidbyt mobile app. Do not put real credentials in Git or screenshots.

Optional: `schedule_mode` (`clock-cycle` default, or `priority`), `clock_seconds` (30 default), `screen_seconds` (15 default), `children` (list of name/birth_date/style, empty disables age screens), legacy `baby_birth_date`/`baby_name`, `starfield_enabled` (default true), `installation_id` (stable alphanumeric ID, default `tidbytrmain`), `favorite_teams`, `log_level`, `scheduler_interval_seconds`, `refresh_interval_seconds`, and both `quiet_hours_start`/`quiet_hours_end` (`HH:mm`). Empty team lists disable sports. The old default `tidbytr-main` normalizes to `tidbytrmain`.

For standalone development, corresponding environment variables are `TIDBYTR_API_TOKEN`, `TIDBYTR_DEVICE_ID`, `TIDBYTR_INSTALLATION_ID`, `TIDBYTR_TIMEZONE`, `TIDBYTR_LATITUDE`, `TIDBYTR_LONGITUDE`, `TIDBYTR_NWS_CONTACT`, comma-separated `TIDBYTR_FAVORITE_TEAMS`, `TIDBYTR_BABY_BIRTH_DATE`, `TIDBYTR_BABY_NAME`, and `TIDBYTR_STARFIELD_ENABLED` (`true` or `false`). Dashboard defaults to port 8787 and data to `.tidbytr`; HA uses `/data`.

## Stock-firmware delivery

Production firmware uses its normal cloud connection. Tidbytr sends base64 WebP to `https://api.tidbyt.com/v0/devices/{deviceId}/push` with bearer authorization and `installationID`. Clock-led slot transitions use `background: false` to request immediate display, while continuing clock/data refreshes use `background: true`. Priority-mode ordinary updates use background delivery to coexist with Store apps. Manual requests, active manual holds, and critical alerts request immediate display. These are Tidbyt API semantics also exposed by [Pixlet push](https://github.com/tidbyt/pixlet/blob/v0.34.0/cmd/push.go).

No HDK listener or port 8788 remains. For closest clock-led timing, leave only Tidbytr enabled in the device app rotation; other apps can shorten physical clock exposure. API acceptance is not device telemetry. Tidbytr cannot guarantee physical dwell time, interruption latency, or control over Store apps. Upgrading from HDK requires restoring production firmware; see the root README.

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
- `POST /api/actions/source`: `sourceId` and `enabled`. Clock cannot be disabled. `local` controls Personal & ambient screens.

## Local screens

Clock uses 12-hour time without a leading zero. The date is centered beneath a one-pixel red divider. Personal screens configures a `children` list through `PUT /api/config`: each child has a stable `id`, `name`, `birthDate` (YYYY-MM-DD), and `style` (`boy`, `girl`, or `neutral`). Name/date are required; omitted styles default to neutral. IDs may be omitted on input and are generated from name/date; retain returned IDs on later edits. Duplicate IDs and invalid dates/styles are rejected; up to 20 children are supported. An explicit empty list disables age screens. Legacy `babyBirthDate`/`babyName` remain readable if no list is configured; saving a list clears those legacy fields. The UI supports add/edit/remove, per-child styles, and `starfieldEnabled`.

Blue, pink, and green accents apply to the name, heart, and secondary text; the primary age stays high-contrast. Future birth dates omit that child's panel until the local birth date. A long name is abbreviated on the display while the full setting is preserved. Each child has its own panel ID and history. Clock-led age slots choose the least recently shown eligible child, giving one child a turn per round while retaining full clock gaps and the weather/stars cadence. Publication failures do not count as a turn. Quiet hours, source disabling, snooze, and manual holds still apply. In priority mode, children are independent candidates with the shared age priority/cooldown policy.

HA uses `children: [{name, birth_date, style, id?}]`; an HA default empty list on upgrade preserves legacy single-child settings. Clear legacy birth-date settings too when disabling age screens through HA. `TIDBYTR_CHILDREN` accepts the JSON camelCase list for standalone deployments. Dashboard saves take ownership of ordinary settings, including children.

Age is calendar-based: month-end/leap anniversaries clamp to the month's last day, and total days/weeks use local dates rather than elapsed hours. The age panel version changes at local midnight. It shows months/days below one year, years/months after, with weeks/remaining days beneath. No real birth date is included in public defaults or fixtures.

Baby age and starfield use source `local`; its toggle, snooze, quiet hours, and critical-alert precedence apply normally. In priority mode, defaults are baby priority 25 and 600-second cooldown; starfield priority 10 and 300-second cooldown. Clock-led mode uses its own fixed slot durations and bypasses ordinary priority/cooldown rules. Old saved policy objects inherit the new keys while keeping existing priorities. Disabling/hiding a manually held local screen clears the unavailable hold and selects a replacement.

Starfield is generated on the native pixel grid, with 80 frames at 50 ms (four seconds) in an infinite WebP loop, under the normal 512 KiB bound. It needs no network provider. Both renderer paths use the same native starfield engine. `pnpm render:local` generates the clock, baby-age sample, GIF previews, and starfield motion strip. Physical device playback remains unmeasured.

## Clock-led scheduling

`screenPolicy.mode` defaults to `clock-cycle`, with `clockSeconds: 30` and `screenSeconds: 15`. Order: clock → forecast → clock → baby-age → clock → starfield, then repeat. Clock must be longer than other slots. Only eligible, nonexpired, enabled cycle items are selected. Missing screens are skipped; clock continues when none are available. Ordinary sports/advisories are excluded from the cycle. Critical alerts retain their interrupt/rotation handling. After they clear, a fresh full clock slot precedes the pending next item.

A persisted `cycleNextIndex` advances only after successful content publication. Background refreshes and changed data keep the existing slot start. Renderer failure plus successful clock fallback advances past the failed item and starts a fresh clock gap. Upload failure leaves the cursor unchanged. Manual holds override ordinary slots; Skip consumes the item and returns through clock; Snooze/quiet hours permit only clock/critical content. Mode changes start a new clock-led sequence and clear manual holds.

The timer wakes at slot/hold boundaries, as well as regular/minute refreshes, so 90/15 durations need not be multiples of the normal scheduler cadence. These are requested timings; API acceptance is not measured device exposure.

The Rotation dashboard form edits mode/durations. `PUT /api/config` accepts partial top-level `screenPolicy` fields, preserving other fields. Existing saved policy objects default missing mode/duration fields to the new clock-led mode; old priority maps remain available. HA baseline uses `schedule_mode`, `clock_seconds`, and `screen_seconds`.

## Priority and freshness

With `screenPolicy.mode: "priority"`, the Screen priorities form edits priority (0–100), cooldown (20–3600 seconds), and minimum selection time (20–120 seconds). Defaults: 20-second minimum, live games repeat after 60 seconds, advisories 120, forecast/upcoming games 300, finals 600. Score/status changes bypass cooldown after minimum dwell. Ordinary waiting candidates gain preference and clock fills gaps. Critical warnings/watches interrupt other Tidbytr content and rotate with concurrent critical alerts, including during snooze/quiet hours. Advisories respect snooze/quiet hours. Server selection history reflects API-accepted selections, not measured device exposure.

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
