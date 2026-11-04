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
- `signDirect` answers with the wallet's own fee in `signed`. Build and broadcast the transaction from `signed`, never from the request. The wallet may change only the fee: the connector rejects an answer whose `bodyBytes` differ from the request's.
- Disconnecting is done in the wallet's Settings, so `disconnect` does nothing.
- Account changes arrive as the window event `beepocket_keystorechange` (the wallet emits `accountChanged`) or through `provider.on('accountChanged', …)`.
- Provider errors carry a `code`: `rejected`, `locked-timeout`, `not-connected`, `wrong-chain`, `invalid-request`, `expired` or `unavailable`.
- `unavailable` means the page cannot reach the wallet: the extension was updated or reloaded under the open page, or it did not take the request within 10 seconds. A request that ends this way is also withdrawn from the wallet, so it never opens a window or broadcasts later. Once the wallet has taken a request, the provider waits for its answer. The wallet ends a request nobody answered with `expired` after 10 minutes, but if an answer is lost on the way, the provider notices only when it gives up 11 minutes after the wallet took the request. There is no earlier signal. Ask the user to reload the page. Through interchain-kit, a `signDirect` or `sendTx` that fails with `unavailable` also emits `accountChanged`, so the account refresh fails and the wallet shows as disconnected.

MIT licensed.
