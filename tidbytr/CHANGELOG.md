# Changelog

## 0.4.0

- Replace Tidbyt cloud push delivery with HDK local pull from `/current.webp`.
- Add a read-only display listener on port `8788` while keeping the Ingress dashboard on `8787`.
- Add `display_base_url` configuration and remove Tidbyt cloud credential options.
- Track last publish, current frame, last firmware pull, and polling-based online status.

## 0.3.0

- Add deterministic Pixlet display payloads so screen rendering can be tested reliably.
- Add renderer fixture tooling for reviewing panel WebP and PNG output.
- Add optional Pixlet visual layout tests for clock, forecast, NWS alert, and live score panels.
- Migrate upcoming game, live score, and final score panels to Pixlet templates.

## 0.2.0

- Add a Pixlet-backed renderer for clock, forecast, and NWS alert panels.
- Bundle pinned Pixlet 0.34.0 in the Home Assistant add-on image for amd64 and aarch64.
- Keep the existing Sharp renderer as a development and sports-panel fallback.
- Record scheduled render failures as not shown while returning concise preview render errors.

## 0.1.3

- Fix the default Tidbyt installation ID so it is alphanumeric and accepted by the Tidbyt API.
- Migrate the previous built-in `tidbytr-main` default to `tidbytrmain` during option normalization.
- Avoid Home Assistant add-on build failures before a matching release tag exists by making the Docker source ref configurable.

## 0.1.2

- Fix the dashboard white screen under Home Assistant Ingress by using relative Vite assets and Ingress-aware API URLs.
- Pin the add-on Docker source download to the matching release tag for reproducible Home Assistant builds.

## 0.1.1

- Fix Home Assistant add-on Docker builds by making the Dockerfile valid from the add-on folder build context.
- Remove deprecated `armv7` architecture from the add-on metadata.

## 0.1.0

- Initial V1 add-on package.
- Fastify API and React dashboard.
- 64x32 WebP renderer.
- Priority scheduler with skip, snooze, source toggles, and history.
- NWS weather and ESPN-style sports provider interfaces.
