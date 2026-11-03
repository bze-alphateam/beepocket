# Releasing

The extension version lives in `packages/extension/package.json` and nowhere else; the build writes it into `manifest.json`. It must be a Chrome version: 1 to 4 dot-separated integers (0-65535, no leading zeros, no `-rc` style suffix).

1. In the release pull request into `main`, bump `version` in `packages/extension/package.json`.
2. After it merges, tag the merge commit `v` + that version (for example `v1.2.3`) and push the tag:

   ```sh
   git tag v1.2.3 <merge commit>
   git push origin v1.2.3
   ```

3. The `reproducible` workflow builds the zip twice, checks that both builds match and that the tag matches the package version, then creates a **draft** GitHub release with `beepocket-v1.2.3.zip`, `SHA256SUMS` and a build provenance attestation. A mismatched tag or a non-reproducible build creates nothing.
4. Review the draft (notes, assets, sums) and publish it by hand. Nothing is published automatically.

The release notes come from [`.github/release-notes.md`](.github/release-notes.md), with `{{VERSION}}` replaced by the tag.

## Extension ID

`packages/extension/public/manifest.json` carries a fixed public `key`, so an unpacked install always gets the ID `ijohiojehlnmpoelmpnnbcfhkpgaclfc`, whatever folder it is loaded from. Only the public key is in the repository; no private key is needed to load the extension unpacked. Don't change the `key`: a new one gives a new ID, and users updating in place would lose access to their wallet data.

The Chrome Web Store manages its own key, so the store upload (later) must use a zip whose `manifest.json` has no `key` field.
