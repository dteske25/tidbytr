FROM node:24-bookworm-slim AS build

WORKDIR /app

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

ADD https://codeload.github.com/dteske25/tidbytr/tar.gz/refs/heads/main /tmp/tidbytr.tar.gz
RUN tar -xzf /tmp/tidbytr.tar.gz --strip-components=1 -C /app

RUN corepack enable && pnpm install --frozen-lockfile

RUN pnpm build && pnpm prune --prod

FROM node:24-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV TIDBYTR_HOST=0.0.0.0
ENV TIDBYTR_PORT=8787
ENV TIDBYTR_DATA_DIR=/data
ENV TIDBYTR_CONFIG_PATH=/data/config.json

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY run.sh /run.sh

RUN chmod +x /run.sh && mkdir -p /data

EXPOSE 8787

CMD ["/run.sh"]
