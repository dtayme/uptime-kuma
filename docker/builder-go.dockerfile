############################################
# Build in Golang
# Run npm run build-healthcheck-armv7 in the host first, another it will be super slow where it is building the armv7 healthcheck
############################################
FROM golang:1.23.8-bookworm
WORKDIR /app
ARG TARGETPLATFORM
COPY ./extra/healthcheck-src/ ./extra/healthcheck-src/

# Compile healthcheck (extra/healthcheck-src/healthcheck.go)
RUN apt update && \
    apt --yes --no-install-recommends install curl && \
    curl -sL https://deb.nodesource.com/setup_22.x | bash && \
    apt --yes --no-install-recommends install nodejs && \
    node ./extra/healthcheck-src/build-healthcheck.js $TARGETPLATFORM && \
    apt --yes purge nodejs curl && \
    apt --yes autoremove && \
    rm -rf /var/lib/apt/lists/*
