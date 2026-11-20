# Releasing

The extension version lives in `packages/extension/package.json` and nowhere else; the build writes it into `manifest.json`. It must be a Chrome version: 1 to 4 dot-separated integers (0-65535, no leading zeros, no `-rc` style suffix).

Releases are built, signed and published locally by a maintainer. CI uploads no build output: the `reproducible` workflow only checks that two clean builds of the same commit give the same zip, and on a `v*` tag that the tag matches the package version.

1. In the release pull request into `main`, bump `version` in `packages/extension/package.json`.
2. After it merges, tag the merge commit `v` + that version (for example `v1.2.3`) and push the tag:

   ```sh
   git tag v1.2.3 <merge commit>
   git push origin v1.2.3
   ```

3. Wait for the `reproducible` workflow on the tag to pass. Note the sha256 it prints in the job summary.
4. From a clean checkout of the tag, build the zip the same way CI does:

   ```sh
   git checkout v1.2.3
   git clean -xdff
   corepack enable
   pnpm install --frozen-lockfile
   SOURCE_DATE_EPOCH="$(git log -1 --format=%ct)" pnpm build
   cp packages/extension/beepocket.zip beepocket-v1.2.3.zip
   sha256sum beepocket-v1.2.3.zip > SHA256SUMS
   ```

   The sum must match the one in the workflow summary.
5. Create the GitHub release for the tag and attach `beepocket-v1.2.3.zip` and `SHA256SUMS`. The release notes should cover install, update (unzip over the same folder, never remove the extension) and verification, as in the README.

## Extension ID

`packages/extension/public/manifest.json` carries a fixed public `key`, so an unpacked install always gets the ID `ijohiojehlnmpoelmpnnbcfhkpgaclfc`, whatever folder it is loaded from. Only the public key is in the repository; no private key is needed to load the extension unpacked. Don't change the `key`: a new one gives a new ID, and users updating in place would lose access to their wallet data.

The Chrome Web Store manages its own key, so the store upload (later) must use a zip whose `manifest.json` has no `key` field.
