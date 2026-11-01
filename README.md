# BeePocket

BeePocket is a security-first browser-extension wallet for the BeeZee (BZE) network. It is BZE-only, open source (MIT) and built to be verified: every release can be rebuilt from its tag and compared byte for byte.

> Status: repository bootstrap. There is no wallet logic yet.

## Security principles

- **Self-custody.** Keys are generated and used on the user's device and never leave it.
- **Tiny supply chain.** Runtime dependencies are limited to `@noble/*`, `@scure/*` and `preact`. Everything else is a dev dependency, and every version is pinned exactly.
- **No install scripts.** `ignore-scripts=true` is set in `.npmrc`; the lockfile is committed and CI installs with `--frozen-lockfile`.
- **Minimal permissions.** The manifest asks for `storage` and `alarms` only, with no host permissions until a feature needs them, and a strict extension-page CSP.
- **Reproducible builds.** The release zip is built twice in fresh CI jobs and the SHA-256 sums must match.

## Layout

| Package              | Purpose                                        |
| -------------------- | ---------------------------------------------- |
| `packages/core`      | Wallet logic, no DOM (`@beepocket/core`)       |
| `packages/extension` | Chrome MV3 extension: service worker and popup |
| `packages/connector` | dapp connector (`@bze/beepocket-connector`)    |

## Build

Requires Node 24 (see `.nvmrc`) and pnpm (pinned in `package.json`, use Corepack: `corepack enable`).

```sh
pnpm install --frozen-lockfile
pnpm check   # format, lint, typecheck, dependency policy, build, unit tests
pnpm e2e     # build and run the Playwright test against the built extension
```

The extension is built into `packages/extension/dist` and zipped to `packages/extension/beepocket.zip`. To try it, open `chrome://extensions`, enable developer mode and load the `dist` folder as an unpacked extension.

## Verify a release

Releases are built by CI from a `v*` tag, and the zip and its SHA-256 are attached to the GitHub release. To check one yourself:

```sh
git checkout vX.Y.Z
corepack enable
pnpm install --frozen-lockfile
SOURCE_DATE_EPOCH="$(git log -1 --format=%ct)" pnpm build
sha256sum packages/extension/beepocket.zip
```

The sum must match the one published with the release.

## License

MIT, see [LICENSE](LICENSE).
