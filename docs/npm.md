# NPM Notes

## Install Requirements

This repo currently relies on `.npmrc`:

```
legacy-peer-deps=true
```

Reason: `vue-confirm-dialog@1.0.2` declares a peer dependency on `vue@^2.6.10`, but the app uses `vue@~3.5.26`. Without `legacy-peer-deps`, `npm install` fails with an `ERESOLVE` peer conflict.

To remove this requirement, we need to upgrade/replace `vue-confirm-dialog` with a Vue 3 compatible alternative (or remove it entirely).

## Dependency Changes (Recent)

These are recent adjustments made to resolve vulnerability alerts and CI install issues:

- `tar` updated to `~7.5.7` (fixes reported tar CVEs).
- `fast-xml-parser` pinned to `5.3.4` (direct dependency + override to patch CVE).
- `@aws-sdk/credential-providers` updated to `^3.982.0` so transitive `@aws-sdk/xml-builder` uses `fast-xml-parser@5.3.4`.
- `glob` overridden to `10.5.0` and `workbox-build` forced to `glob@11.1.0` to address `glob` CLI issues.
- `lodash` overridden to `4.17.23` to address prototype pollution CVE.
- `esbuild` overridden to `0.25.0` to address dev-server CORS advisory.
- `qs` overridden to `6.14.1` and removed from direct dependencies (used only transitively now).
- `source-map` overridden to `source-map-js@1.2.1`.
- `sourcemap-codec` overridden to `@jridgewell/sourcemap-codec@1.5.5`.
- `event-to-promise` pinned to `file:vendor/event-to-promise`.

## CI Note

CI workflows that run `npm ci`/`npm clean-install` now upgrade npm to v11 to ensure overrides are applied consistently in GitHub Actions.
