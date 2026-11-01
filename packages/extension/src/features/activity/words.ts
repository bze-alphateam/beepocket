import { t, type StringKey } from '../../i18n';

/** What `wordsFor` needs of a Scan row. */
export interface WordsInput {
  kind: string;
  category: string;
  isSigner: boolean;
  success: boolean;
}

type Words = StringKey | { signer: StringKey; other: StringKey };

/** Scan's `kind` values (backend classify tables) → plain words; some read differently per side. */
const WORDS: Readonly<Record<string, Words>> = {
  nft_send: { signer: 'activity.word.nft.sent', other: 'activity.word.nft.received' },
  vesting_create: {
    signer: 'activity.word.vesting.created',
    other: 'activity.word.vesting.received',
  },
  article: { signer: 'activity.word.article.added', other: 'activity.word.article.received' },
  respect: { signer: 'activity.word.respect.paid', other: 'activity.word.respect.received' },
  delegate: 'activity.word.delegate',
  undelegate: 'activity.word.undelegate',
  redelegate: 'activity.word.redelegate',
  cancel_unbonding: 'activity.word.cancel_unbonding',
  validator: 'activity.word.validator',
  claim_rewards: 'activity.word.claim_rewards',
  claim_commission: 'activity.word.claim_commission',
  withdraw_address: 'activity.word.withdraw_address',
  community_pool_fund: 'activity.word.community_pool_fund',
  validator_rewards_deposit: 'activity.word.validator_rewards_deposit',
  proposal: 'activity.word.proposal',
  proposal_deposit: 'activity.word.proposal_deposit',
  vote: 'activity.word.vote',
  proposal_cancel: 'activity.word.proposal_cancel',
  authz_exec: 'activity.word.authz_exec',
  authz_grant: 'activity.word.authz_grant',
  authz_revoke: 'activity.word.authz_revoke',
  feegrant_grant: 'activity.word.feegrant_grant',
  feegrant_revoke: 'activity.word.feegrant_revoke',
  feegrant_prune: 'activity.word.feegrant_prune',
  group: 'activity.word.group',
  dex_order: 'activity.word.dex_order',
  dex_cancel: 'activity.word.dex_cancel',
  dex_fill: 'activity.word.dex_fill',
  dex_swap: 'activity.word.dex_swap',
  liquidity: 'activity.word.liquidity',
  dex_pool: 'activity.word.dex_pool',
  dex_market: 'activity.word.dex_market',
  dex_order_saved: 'activity.word.dex_order_saved',
  dex_refund: 'activity.word.dex_refund',
  dex_cancel_skipped: 'activity.word.dex_cancel_skipped',
  dex_failed: 'activity.word.dex_failed',
  burner_fund: 'activity.word.burner_fund',
  raffle_join: 'activity.word.raffle_join',
  raffle_start: 'activity.word.raffle_start',
  burner_move: 'activity.word.burner_move',
  raffle_won: 'activity.word.raffle_won',
  raffle_lost: 'activity.word.raffle_lost',
  raffle_finished: 'activity.word.raffle_finished',
  burned: 'activity.word.burned',
  token_create: 'activity.word.token_create',
  token_mint: 'activity.word.token_mint',
  token_burn: 'activity.word.token_burn',
  token_admin: 'activity.word.token_admin',
  token_update: 'activity.word.token_update',
  reward_join: 'activity.word.reward_join',
  reward_exit: 'activity.word.reward_exit',
  reward_claim: 'activity.word.reward_claim',
  reward_program: 'activity.word.reward_program',
  reward_won: 'activity.word.reward_won',
  unbonding_completed: 'activity.word.unbonding_completed',
  redelegation_completed: 'activity.word.redelegation_completed',
  slashed: 'activity.word.slashed',
  proposal_resolved: 'activity.word.proposal_resolved',
  proposal_dropped: 'activity.word.proposal_dropped',
  epoch: 'activity.word.epoch',
  relay: 'activity.word.relay',
  ibc_in: 'activity.word.ibc_in',
  ibc_refund: 'activity.word.ibc_refund',
  fee_only: 'activity.word.fee_only',
};

/**
 * The plain words of a Scan activity row. `send` reads from the row's category (sent or
 * received); anything Scan adds later falls back to "Transaction"; a failed row says so.
 */
export function wordsFor(row: WordsInput): string {
  const text = base(row);
  return row.success ? text : t('activity.failed', { what: text });
}

function base(row: WordsInput): string {
  if (row.kind === 'send') {
    return t(row.category === 'received' ? 'activity.word.received' : 'activity.word.sent');
  }
  const entry = Object.hasOwn(WORDS, row.kind) ? WORDS[row.kind] : undefined;
  if (entry === undefined) return t('activity.word.fallback');
  if (typeof entry === 'string') return t(entry);
  return t(row.isSigner ? entry.signer : entry.other);
}
