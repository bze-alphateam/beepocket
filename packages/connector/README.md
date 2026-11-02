# @bze/beepocket-connector

Connect your dapp to [BeePocket](https://getbze.com/wallet/add/), the BeeZee (BZE) browser-extension wallet. The package ships the TypeScript types of `window.beepocket` and a ready-made [interchain-kit](https://github.com/hyperweb-io/interchain-kit) 0.11 wallet. It has no runtime dependencies; `@interchain-kit/core` is a peer dependency.

```tsx
import { ChainProvider } from '@interchain-kit/react';
import { keplrWallet } from '@interchain-kit/keplr-extension';
import { beePocketWallet } from '@bze/beepocket-connector';

export function Provider({ children }) {
  return (
    <ChainProvider chains={chains} assetLists={assetLists} wallets={[beePocketWallet, keplrWallet]}>
      {children}
    </ChainProvider>
  );
}
```

Without interchain-kit, use the provider directly:

```ts
import { getBeePocket } from '@bze/beepocket-connector';

const beepocket = await getBeePocket(); // undefined when the extension is not installed
const key = await beepocket?.connect('beezee-1');
```

## Good to know

- BeePocket serves BeeZee only: `beezee-1` and `bzetestnet-3`. Connecting to any other chain throws, and the wallet never suggests a chain.
- BeePocket signs **direct only** (`signDirect`). `signAmino` and `signArbitrary` throw. A dapp that sets `preferredSignType: 'amino'` must route BeePocket to direct signing.
- `signDirect` answers with the wallet's own fee in `signed`. Build and broadcast the transaction from `signed`, never from the request.
- Disconnecting is done in the wallet's Settings, so `disconnect` does nothing.
- Account changes arrive as the window event `beepocket_keystorechange` (the wallet emits `accountChanged`) or through `provider.on('accountChanged', …)`.
- Provider errors carry a `code`: `rejected`, `locked-timeout`, `not-connected`, `wrong-chain`, `invalid-request` or `expired`.

MIT licensed.
