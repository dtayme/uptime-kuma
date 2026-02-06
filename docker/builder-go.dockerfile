# syntax=docker/dockerfile:1.7
############################################
# Build in Golang
# Run npm run build-healthcheck-armv7 in the host first, another it will be super slow where it is building the armv7 healthcheck
############################################
FROM golang:1.23.8-bookworm
WORKDIR /app
ARG TARGETPLATFORM
COPY ./extra/healthcheck-src/ ./extra/healthcheck-src/

# Compile healthcheck (extra/healthcheck-src/healthcheck.go)
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    --mount=type=cache,target=/root/.cache/go-build \
    apt update && \
    apt --yes --no-install-recommends install curl && \
    curl -sL https://deb.nodesource.com/setup_22.x | bash && \
    apt --yes --no-install-recommends install nodejs && \
    node ./extra/healthcheck-src/build-healthcheck.js $TARGETPLATFORM && \
    apt --yes purge nodejs curl && \
    apt --yes autoremove
