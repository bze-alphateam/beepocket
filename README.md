# BeePocket

BeePocket is a security-first browser-extension wallet for the BeeZee (BZE) network. It is BZE-only, open source (MIT) and built to be verified: every release can be rebuilt from its tag and compared byte for byte.

> Status: repository bootstrap. There is no wallet logic yet.

## Security principles

- **Self-custody.** Keys are generated and used on the user's device and never leave it.
- **Tiny supply chain.** Runtime dependencies are limited to `@noble/*`, `@scure/*` and `preact`. Everything else is a dev dependency, and every version is pinned exactly.
- **No install scripts.** `ignore-scripts=true` is set in `.npmrc`; the lockfile is committed and CI installs with `--frozen-lockfile`.
- **Minimal permissions.** The manifest asks for `storage` and `alarms` only, with no host permissions until a feature needs them, and a strict extension-page CSP. Reading the clipboard (`clipboardRead`) is optional: the wallet asks for it the first time you tap a Paste button, and Ctrl+V / ⌘V works without it.
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

## Install a release

Download `beepocket-vX.Y.Z.zip` from the [GitHub releases](https://github.com/bze-alphateam/beepocket/releases) (only from there), unzip it into a folder you keep, open `chrome://extensions`, enable developer mode and load that folder with **Load unpacked**. The extension ID is always `ijohiojehlnmpoelmpnnbcfhkpgaclfc`. To update, unzip the new release over the same folder and click reload on the extension card; never remove the extension, or its wallet data is lost. Each release's notes have the full steps.

## Verify a release

Releases are built by CI from a `v*` tag. The zip, a `SHA256SUMS` file and a build provenance attestation are attached to the GitHub release. Check a download with:

```sh
sha256sum -c SHA256SUMS
gh attestation verify beepocket-vX.Y.Z.zip --repo bze-alphateam/beepocket
```

Or rebuild it yourself:

```sh
git checkout vX.Y.Z
corepack enable
pnpm install --frozen-lockfile
SOURCE_DATE_EPOCH="$(git log -1 --format=%ct)" pnpm build
sha256sum packages/extension/beepocket.zip
```

The sum must match the one in the release's `SHA256SUMS`. Maintainers: see [RELEASING.md](RELEASING.md).

## License

MIT, see [LICENSE](LICENSE).
