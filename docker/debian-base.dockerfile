# Download Apprise deb package
ARG ENABLE_APPRISE=1
FROM node:22-bookworm-slim AS download-apprise
ARG ENABLE_APPRISE=1
WORKDIR /app
COPY ./extra/download-apprise.mjs ./download-apprise.mjs
RUN if [ "$ENABLE_APPRISE" = "1" ]; then \
        apt update && \
        apt --yes --no-install-recommends install curl && \
        npm install cheerio semver && \
        node ./download-apprise.mjs; \
    else \
        touch /app/apprise.deb; \
    fi

# Base Image (Slim)
# If the image changed, the second stage image should be changed too
FROM node:22-bookworm-slim AS base2-slim
ARG ENABLE_APPRISE=1
ARG TARGETARCH
ARG TARGETPLATFORM

# Specify --no-install-recommends to skip unused dependencies, make the base much smaller!
# iputils-ping = for ping
# dumb-init = avoid zombie processes (#480)
# ca-certificates = keep the cert up-to-date
RUN apt update && \
    apt --yes --no-install-recommends install  \
        ca-certificates \
        iputils-ping  \
        dumb-init && \
    rm -rf /var/lib/apt/lists/* && \
    apt --yes autoremove

# apprise = for notifications (Install from the deb package, as the stable one is too old) (workaround for #4867)
# Switching to testing repo is no longer working, as the testing repo is not bookworm anymore.
# python3-paho-mqtt (#4859)
# TODO: no idea how to delete the deb file after installation as it becomes a layer already
COPY --from=download-apprise /app/apprise.deb ./apprise.deb
RUN if [ "$ENABLE_APPRISE" = "1" ]; then \
        apt update && \
        apt --yes --no-install-recommends install \
            ./apprise.deb \
            python3-paho-mqtt \
            python3-cryptography \
            python3-urllib3 \
            python3-certifi && \
        rm -rf /var/lib/apt/lists/* && \
        rm -f apprise.deb && \
        apt --yes autoremove; \
    else \
        rm -f apprise.deb; \
    fi

# Install cloudflared
ARG CLOUDFLARED_VERSION=2026.1.2
RUN apt update && \
    apt --yes --no-install-recommends install curl && \
    case "$TARGETARCH" in \
        amd64) CF_ARCH="amd64" ;; \
        arm64) CF_ARCH="arm64" ;; \
        arm) CF_ARCH="arm" ;; \
        *) echo "Unsupported TARGETARCH: $TARGETARCH" && exit 1 ;; \
    esac && \
    curl -fsSL -o /usr/local/bin/cloudflared \
        "https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-linux-${CF_ARCH}" && \
    chmod +x /usr/local/bin/cloudflared && \
    /usr/local/bin/cloudflared version && \
    apt --yes purge curl && \
    rm -rf /var/lib/apt/lists/* && \
    apt --yes autoremove

# Runtime base without npm (reduce CVEs in runtime image)
FROM base2-slim AS base2-slim-runtime
RUN rm -rf /usr/lib/node_modules/npm \
    /usr/local/lib/node_modules/npm \
    /usr/local/bin/npm \
    /usr/local/bin/npx \
    /usr/local/bin/corepack \
    /usr/bin/npm \
    /usr/bin/npx \
    /usr/bin/corepack

# Full Base Image
# MariaDB, Chromium and fonts
# Make sure to reuse the slim image here. Uncomment the above line if you want to build it from scratch.
# FROM base2-slim AS base2
FROM base2-slim-runtime AS base2
ENV UPTIME_KUMA_ENABLE_EMBEDDED_MARIADB=1
RUN apt update && \
    apt --yes --no-install-recommends install chromium fonts-indic fonts-noto fonts-noto-cjk mariadb-server && \
    rm -rf /var/lib/apt/lists/* && \
    apt --yes autoremove && \
    chown -R node:node /var/lib/mysql

