# Versioning

## Source of Truth

- `package.json` `version` is the canonical application version.
- Runtime components read the version from `package.json` (e.g., `server/check-version.js`).

## Release Flows

- Stable releases: `extra/update-version.js` reads `RELEASE_VERSION`, updates `package.json` and `package-lock.json`, then commits.
- Beta releases: `extra/beta/update-version.mjs` reads `RELEASE_BETA_VERSION`, updates `package.json` and `package-lock.json`, then commits.
- Nightly builds: `extra/mark-as-nightly.js` appends a timestamp suffix to the current version and updates `README.md` for that nightly build.

## Fork-Friendly Version Helper

Use `extra/derive-version.js` to generate versions for production, pre-release, alpha, or beta channels, optionally appending build metadata (including commit count + short SHA).

Example (beta with commit metadata):

```bash
node extra/derive-version.js --base 2.1.0 --channel beta --number 3 --commit-metadata
```

Produces:

```
2.1.0-beta.3+distributed.<count>.<sha>
```

Environment variables (optional):

- `RELEASE_BASE_VERSION` (required if `--base` not provided)
- `RELEASE_CHANNEL` (`production|pre|alpha|beta`)
- `RELEASE_CHANNEL_NUMBER` (numeric)
- `RELEASE_BUILD_METADATA` (extra build metadata)
- `RELEASE_BUILD_METADATA_PREFIX` (default `distributed`)
- `RELEASE_INCLUDE_COMMIT_METADATA=1` (append git count+sha)

## Where It Appears

- Server log/telemetry uses the `package.json` version (see `server/server.js` and `server/check-version.js`).
- UI displays the server version in Settings > About.
