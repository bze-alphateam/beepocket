/**
 * Each module's governance-only messages: signed by the gov module, never by a wallet user. The
 * summariser gives them one generic line; sign-request checks refuse them.
 */
export const GOVERNANCE_ONLY: ReadonlyMap<string, string> = new Map([
  ['/bze.burner.MsgUpdateParams', 'Update burner settings'],
  ['/bze.cointrunk.MsgUpdateParams', 'Update CoinTrunk settings'],
  ['/bze.rewards.MsgUpdateParams', 'Update rewards settings'],
  ['/bze.tokenfactory.MsgUpdateParams', 'Update token factory settings'],
  ['/bze.tradebin.MsgUpdateParams', 'Update tradebin settings'],
  ['/bze.txfeecollector.MsgUpdateParams', 'Update fee collector settings'],
  ['/bze.tradebin.MsgHaltDenoms', 'Halt trading of tokens'],
  ['/bze.tradebin.MsgUnhaltDenoms', 'Resume trading of tokens'],
  ['/bze.cointrunk.MsgAcceptDomain', 'Change an accepted news domain'],
  ['/bze.cointrunk.MsgSavePublisher', 'Save a CoinTrunk publisher'],
  ['/bze.tokenfactory.MsgSetDenomAdmin', 'Change a token admin'],
  ['/bze.tradebin.MsgUpdatePools', 'Update liquidity pools'],
  ['/bze.dao.MsgUpdateParams', 'Update DAO settings'],
  ['/bze.guardian.v1.MsgUpdateParams', 'Update guardian settings'],
  ['/bze.guardian.v1.MsgUnblockDenom', 'Unblock a token'],
  ['/bze.guardian.v1.MsgResumeAutomation', 'Resume automatic chain jobs'],
  ['/bze.guardian.v1.MsgReopenChannel', 'Reopen an IBC channel'],
  ['/ratelimit.v1.MsgAddRateLimit', 'Add an IBC rate limit'],
  ['/ratelimit.v1.MsgUpdateRateLimit', 'Change an IBC rate limit'],
  ['/ratelimit.v1.MsgRemoveRateLimit', 'Remove an IBC rate limit'],
  ['/ratelimit.v1.MsgResetRateLimit', 'Reset an IBC rate limit'],
]);
