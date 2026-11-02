# Releasing @bze/beepocket-connector

CI never publishes. A maintainer with npm access publishes by hand.

1. Start from an up-to-date `develop` (or the release tag) and set the new version in `package.json`. Keep the peer range `@interchain-kit/core` `0.11.x` unless the dapps move to another interchain-kit line.
2. Install and build from a clean tree:

   ```sh
   pnpm install --frozen-lockfile
   pnpm --filter @bze/beepocket-connector run build
   pnpm --filter @bze/beepocket-connector test
   ```

3. Check the tarball. It must hold only `dist/`, `README.md`, `LICENSE` and `package.json`:

   ```sh
   cd packages/connector
   pnpm pack
   tar -tzf bze-beepocket-connector-*.tgz
   ```

4. Log in to npm with an account in the `@bze` scope and publish:

   ```sh
   npm login
   npm publish --access public
   ```

   `npm publish` packs the same files; there is no `prepublish` script.

5. Tag the commit `connector-vX.Y.Z` and push the tag.
