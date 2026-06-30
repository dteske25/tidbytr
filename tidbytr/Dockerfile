FROM node:24-bookworm-slim AS build

WORKDIR /app

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ARG TIDBYTR_SOURCE_REF=refs/heads/main

ADD https://codeload.github.com/dteske25/tidbytr/tar.gz/${TIDBYTR_SOURCE_REF} /tmp/tidbytr.tar.gz
RUN tar -xzf /tmp/tidbytr.tar.gz --strip-components=1 -C /app

RUN corepack enable && pnpm install --frozen-lockfile

RUN pnpm build && pnpm prune --prod

FROM node:24-bookworm-slim

WORKDIR /app

ARG TARGETARCH
ARG PIXLET_VERSION=0.34.0

ENV NODE_ENV=production
ENV TIDBYTR_HOST=0.0.0.0
ENV TIDBYTR_PORT=8787
ENV TIDBYTR_DATA_DIR=/data
ENV TIDBYTR_CONFIG_PATH=/data/config.json

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && case "${TARGETARCH}" in \
    amd64) PIXLET_ARCH="amd64" ;; \
    arm64|aarch64) PIXLET_ARCH="arm64" ;; \
    *) echo "Unsupported Pixlet architecture: ${TARGETARCH}" >&2; exit 1 ;; \
  esac \
  && PIXLET_ARCHIVE="pixlet_${PIXLET_VERSION}_linux_${PIXLET_ARCH}.tar.gz" \
  && curl -fsSL "https://github.com/tidbyt/pixlet/releases/download/v${PIXLET_VERSION}/${PIXLET_ARCHIVE}" -o "/tmp/${PIXLET_ARCHIVE}" \
  && curl -fsSL "https://github.com/tidbyt/pixlet/releases/download/v${PIXLET_VERSION}/checksums.txt" -o /tmp/pixlet-checksums.txt \
  && cd /tmp \
  && grep "  ${PIXLET_ARCHIVE}$" pixlet-checksums.txt | sha256sum -c - \
  && tar -xzf "${PIXLET_ARCHIVE}" -C /usr/local/bin pixlet \
  && chmod +x /usr/local/bin/pixlet \
  && rm -f "/tmp/${PIXLET_ARCHIVE}" /tmp/pixlet-checksums.txt \
  && apt-get purge -y --auto-remove curl \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY run.sh /run.sh

RUN chmod +x /run.sh && mkdir -p /data

EXPOSE 8787

CMD ["/run.sh"]
