# Changelog

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
