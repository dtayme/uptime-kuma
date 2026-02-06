ARG BASE_IMAGE=fognetx/uptime-kuma-distributed:base2
ARG BUILD_BASE_IMAGE=fognetx/uptime-kuma-distributed:base2-slim

############################################
# Build poller dependencies
############################################
FROM $BUILD_BASE_IMAGE AS build
USER node
WORKDIR /app

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1

COPY --chown=node:node .npmrc .npmrc
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --chown=node:node poller ./poller
COPY --chown=node:node server/monitor-conditions ./server/monitor-conditions
COPY --chown=node:node src/util.js ./src/util.js
RUN mkdir -p /app/poller-data

############################################
# Poller runtime image
############################################
FROM $BASE_IMAGE AS poller
USER node
WORKDIR /app

ENV NODE_ENV=production
ENV POLLER_DB_PATH=/app/poller-data/poller.sqlite

COPY --chown=node:node --from=build /app /app

VOLUME ["/app/poller-data"]
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "poller/index.js"]

