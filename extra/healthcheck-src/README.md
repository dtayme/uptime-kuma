# Healthcheck Build Assets

This directory contains the source and build helper for the standalone
healthcheck binary used by the Docker images.

Files:
- `healthcheck.go`: Go source for the healthcheck binary.
- `build-healthcheck.js`: Node wrapper that builds the binary during Docker
  builds.
- `healthcheck.js`: Deprecated JS implementation kept for reference.

Build outputs:
- `./extra/healthcheck` (binary) is produced by `build-healthcheck.js`.
- `./extra/healthcheck-src/healthcheck-armv7` (optional) can be produced on the host to speed
  up ARMv7 builds.
