# Contributing

## Branches

- `main` holds releases.
- `develop` is the integration branch. Open pull requests against `develop`.
- Name branches `<type>/<short-description>`, for example `feat/send-form`.

## Releases

The extension version lives in `packages/extension/package.json` and nowhere else; the build writes it into `manifest.json`. It must be a Chrome version: 1 to 4 dot-separated integers (0-65535, no leading zeros, no `-rc` style suffix).

1. In the release pull request into `main`, bump `version` in `packages/extension/package.json`.
2. After it merges, tag the merge commit `v` + that version (for example `v1.2.3`) and push the tag.
3. The `reproducible` workflow fails the release if the tag does not match the package version.

## Before you open a pull request

```sh
pnpm check
pnpm e2e
```

`pnpm check` mirrors the CI checks `lint`, `build` and `unit`. `pnpm e2e` mirrors `e2e` (install Chromium first with `pnpm --filter @beepocket/extension exec playwright install chromium`). CI also runs `security` (`pnpm audit` and OSV-Scanner) and `codeql`.

## Dependency policy

- **Runtime dependencies** (`dependencies` of `packages/core` and `packages/extension`) are limited to `@noble/*`, `@scure/*`, `preact` and the workspace package `@beepocket/core`. `packages/connector` has no runtime dependencies. Anything else needs a maintainer's explicit approval.
- **Dev dependencies** are free, but every version, runtime or dev, is pinned exactly (no `^` or `~`). `.npmrc` sets `save-exact=true`.
- Install scripts are disabled. If a package genuinely needs one, discuss it first.
- Commit `pnpm-lock.yaml` with every dependency change.

`pnpm check-deps` enforces the allowlist and the exact pinning, and CI runs it in the `lint` check.

## Code style

TypeScript in strict mode with typed ESLint (`strictTypeChecked`) and Prettier. Run `pnpm format` to fix formatting. Dependencies are passed in as interfaces, and tests go through the public API only.
