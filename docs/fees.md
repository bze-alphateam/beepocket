# Network fees

How BeePocket decides which tokens can pay the network fee, what the fee is, which one is
pre-selected and what the user may change. The wallet's own sends and transactions a connected
site asks it to sign follow different selection rules; the pricing is the same for both.

Code: `packages/core/src/fees.ts` (pricing), `packages/extension/src/features/send/service.ts`
(sends), `packages/extension/src/dapp/handlers/sign-prepare.ts` and `sign-direct.ts` (site
requests).

## 1. Which tokens can pay the fee

- **BZE always can.** Its price is the chain's minimum gas price, the txfeecollector
  `ValidatorMinGasFee` param.
- **Another token can when it has a BZE liquidity pool that:**
  - is not halted, and the token is not halted;
  - holds at least the tradebin `minNativeLiquidityForModuleSwap` in BZE;
  - has no empty side.

  Its gas price is the BZE price converted at that pool's spot ratio. This mirrors the chain's
  own rule, since the chain swaps the fee to BZE before the messages run.

- A token is offered only when the balance covers its estimated fee, and only when its name and
  logo can be read (a fee that cannot be shown right is never offered).
- Gas price, pools and halted tokens are cached for 5 minutes.

## 2. The wallet's estimate

The transaction is simulated with an empty fee. From the gas it used:

- **Fee in BZE:** gas limit = ⌈gas used × 1.5⌉, fee = ⌈gas limit × minimum gas price⌉.
- **Fee in another token:** gas limit = ⌈gas used × 1.5 × 1.5⌉ (the fee swap costs gas the
  simulation does not include), fee = the BZE fee for that limit converted at the spot ratio,
  × 1.1 for slippage.

Every step rounds up. The margins match the BZE dapps.

## 3. Wallet sends: the pre-selected fee

The first of these that can pay:

1. the token picked on the fee sheet;
2. the token being sent;
3. BZE;
4. the first option: BZE first, then the others by symbol.

When the fee is paid in the token being sent, amount + fee must fit the balance. **Max** sends
the balance less the fee and is simulated again with that amount.

## 4. Site requests: the pre-selected fee

- **The site sends a fee:** it is the default and is signed exactly as sent, gas limit
  included. It is still shown with a warning when:
  - its gas limit is below what the simulation used (the transaction would run out of gas and
    the fee would still be charged);
  - it is below the chain minimum;
  - it is more than 3 times the wallet's own estimate in that token.
- **The site's fee is dropped**, the wallet picks its own and says so, when it has more than one
  coin, an amount that is not a whole number, a token that cannot pay fees (section 1) or cannot
  be shown, or more than the balance.
- **The site sends no fee** (none, an empty or all-zero amount, or a zero gas limit): BZE when
  the address can pay it, else the first token that can.
- The fee sheet always lists the wallet's own options next to the site's fee.

## 5. Advanced settings

Available for sends and site requests, for the selected fee token.

- **Gas limit picks:** Auto is the estimate; ×1.5, ×2 and ×5 multiply it, rounded up to two
  significant digits; Max is 10 times the estimate.
- **Allowed range:** from the gas the simulation used (for a fee in another token, the BZE
  estimate: gas used × 1.5) up to Max. Below the estimate is allowed with a warning that the
  transaction may run out of gas.
- **Gas price picks:** the chain minimum, ×2 or ×3. BZE has no fee market, so there are only
  these.
- **Refused:** a gas limit outside the range, or a fee the address cannot afford (for a send in
  the fee's own token: the balance less the amount sent).
- Settings that no longer fit after a new simulation reset to the estimate, with a notice.

## 6. Before signing

The service worker prices the reviewed fee again on fresh data and signs only that fee. A fee
that no longer matches what was reviewed sends the user back to the review ("The network fee
changed"). For site requests only the fee is replaced: the site's transaction body is signed
untouched.
