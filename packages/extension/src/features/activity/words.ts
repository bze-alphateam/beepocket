import { t, type StringKey } from '../../i18n';
import type { IconName } from '../../ui';

/** What `wordsFor` needs of a Scan row. */
export interface WordsInput {
  kind: string;
  category: string;
  isSigner: boolean;
  success: boolean;
}

/** Between the address label and the counterparty: value going out, coming in, or neither. */
export type Direction = '→' | '←' | '·';

interface Look {
  word: StringKey;
  icon: IconName;
  dir: Direction;
}

type Entry = Look | { signer: Look; other: Look };

/**
 * Scan's `kind` values (backend classify tables) → plain words, the icon of the row's disc and
 * the arrow of its sub line; some read differently per side.
 */
const LOOKS: Readonly<Record<string, Entry>> = {
  nft_send: {
    signer: { word: 'activity.word.nft.sent', icon: 'send', dir: '→' },
    other: { word: 'activity.word.nft.received', icon: 'receive', dir: '←' },
  },
  vesting_create: {
    signer: { word: 'activity.word.vesting.created', icon: 'send', dir: '→' },
    other: { word: 'activity.word.vesting.received', icon: 'receive', dir: '←' },
  },
  article: {
    signer: { word: 'activity.word.article.added', icon: 'pencil', dir: '·' },
    other: { word: 'activity.word.article.received', icon: 'receive', dir: '←' },
  },
  respect: {
    signer: { word: 'activity.word.respect.paid', icon: 'send', dir: '→' },
    other: { word: 'activity.word.respect.received', icon: 'receive', dir: '←' },
  },
  delegate: { word: 'activity.word.delegate', icon: 'stake', dir: '→' },
  undelegate: { word: 'activity.word.undelegate', icon: 'stake', dir: '←' },
  redelegate: { word: 'activity.word.redelegate', icon: 'stake', dir: '·' },
  cancel_unbonding: { word: 'activity.word.cancel_unbonding', icon: 'stake', dir: '·' },
  validator: { word: 'activity.word.validator', icon: 'shield', dir: '·' },
  claim_rewards: { word: 'activity.word.claim_rewards', icon: 'rewards', dir: '←' },
  claim_commission: { word: 'activity.word.claim_commission', icon: 'rewards', dir: '←' },
  withdraw_address: { word: 'activity.word.withdraw_address', icon: 'pencil', dir: '·' },
  community_pool_fund: { word: 'activity.word.community_pool_fund', icon: 'send', dir: '→' },
  validator_rewards_deposit: {
    word: 'activity.word.validator_rewards_deposit',
    icon: 'send',
    dir: '→',
  },
  proposal: { word: 'activity.word.proposal', icon: 'clipboard', dir: '·' },
  proposal_deposit: { word: 'activity.word.proposal_deposit', icon: 'clipboard', dir: '→' },
  vote: { word: 'activity.word.vote', icon: 'clipboard', dir: '·' },
  proposal_cancel: { word: 'activity.word.proposal_cancel', icon: 'clipboard', dir: '·' },
  authz_exec: { word: 'activity.word.authz_exec', icon: 'code', dir: '·' },
  authz_grant: { word: 'activity.word.authz_grant', icon: 'grant', dir: '·' },
  authz_revoke: { word: 'activity.word.authz_revoke', icon: 'grant', dir: '·' },
  feegrant_grant: { word: 'activity.word.feegrant_grant', icon: 'grant', dir: '·' },
  feegrant_revoke: { word: 'activity.word.feegrant_revoke', icon: 'grant', dir: '·' },
  feegrant_prune: { word: 'activity.word.feegrant_prune', icon: 'grant', dir: '·' },
  group: { word: 'activity.word.group', icon: 'grid', dir: '·' },
  dex_order: { word: 'activity.word.dex_order', icon: 'order', dir: '·' },
  dex_cancel: { word: 'activity.word.dex_cancel', icon: 'x', dir: '·' },
  dex_fill: { word: 'activity.word.dex_fill', icon: 'check', dir: '·' },
  dex_swap: { word: 'activity.word.dex_swap', icon: 'swap', dir: '·' },
  liquidity: { word: 'activity.word.liquidity', icon: 'liquidity', dir: '·' },
  dex_pool: { word: 'activity.word.dex_pool', icon: 'liquidity', dir: '·' },
  dex_market: { word: 'activity.word.dex_market', icon: 'order', dir: '·' },
  dex_order_saved: { word: 'activity.word.dex_order_saved', icon: 'order', dir: '·' },
  dex_refund: { word: 'activity.word.dex_refund', icon: 'receive', dir: '←' },
  dex_cancel_skipped: { word: 'activity.word.dex_cancel_skipped', icon: 'x', dir: '·' },
  dex_failed: { word: 'activity.word.dex_failed', icon: 'alert-triangle', dir: '·' },
  burner_fund: { word: 'activity.word.burner_fund', icon: 'burn', dir: '→' },
  raffle_join: { word: 'activity.word.raffle_join', icon: 'ticket', dir: '→' },
  raffle_start: { word: 'activity.word.raffle_start', icon: 'ticket', dir: '·' },
  burner_move: { word: 'activity.word.burner_move', icon: 'burn', dir: '→' },
  raffle_won: { word: 'activity.word.raffle_won', icon: 'star', dir: '←' },
  raffle_lost: { word: 'activity.word.raffle_lost', icon: 'ticket', dir: '·' },
  raffle_finished: { word: 'activity.word.raffle_finished', icon: 'ticket', dir: '·' },
  burned: { word: 'activity.word.burned', icon: 'burn', dir: '·' },
  token_create: { word: 'activity.word.token_create', icon: 'plus', dir: '·' },
  token_mint: { word: 'activity.word.token_mint', icon: 'plus', dir: '←' },
  token_burn: { word: 'activity.word.token_burn', icon: 'burn', dir: '→' },
  token_admin: { word: 'activity.word.token_admin', icon: 'key', dir: '·' },
  token_update: { word: 'activity.word.token_update', icon: 'pencil', dir: '·' },
  reward_join: { word: 'activity.word.reward_join', icon: 'rewards', dir: '→' },
  reward_exit: { word: 'activity.word.reward_exit', icon: 'rewards', dir: '←' },
  reward_claim: { word: 'activity.word.reward_claim', icon: 'rewards', dir: '←' },
  reward_program: { word: 'activity.word.reward_program', icon: 'rewards', dir: '·' },
  reward_won: { word: 'activity.word.reward_won', icon: 'star', dir: '←' },
  unbonding_completed: { word: 'activity.word.unbonding_completed', icon: 'stake', dir: '←' },
  redelegation_completed: { word: 'activity.word.redelegation_completed', icon: 'stake', dir: '·' },
  slashed: { word: 'activity.word.slashed', icon: 'alert-triangle', dir: '·' },
  proposal_resolved: { word: 'activity.word.proposal_resolved', icon: 'clipboard', dir: '·' },
  proposal_dropped: { word: 'activity.word.proposal_dropped', icon: 'clipboard', dir: '·' },
  epoch: { word: 'activity.word.epoch', icon: 'activity', dir: '·' },
  relay: { word: 'activity.word.relay', icon: 'link', dir: '·' },
  ibc_out: { word: 'activity.word.ibc_out', icon: 'send', dir: '→' },
  ibc_fee: { word: 'activity.word.ibc_fee', icon: 'send', dir: '→' },
  ica: { word: 'activity.word.ica', icon: 'link', dir: '·' },
  evidence: { word: 'activity.word.evidence', icon: 'shield', dir: '·' },
  ibc_in: { word: 'activity.word.ibc_in', icon: 'receive', dir: '←' },
  ibc_refund: { word: 'activity.word.ibc_refund', icon: 'receive', dir: '←' },
  fee_only: { word: 'activity.word.fee_only', icon: 'send', dir: '·' },
};

const SENT: Look = { word: 'activity.word.sent', icon: 'send', dir: '→' };
const RECEIVED: Look = { word: 'activity.word.received', icon: 'receive', dir: '←' };

/** How a row reads: its words, the icon of its disc, and the arrow before its counterparty. */
export interface RowLook {
  words: string;
  icon: IconName;
  /** Null for a kind the wallet doesn't know: no arrow, a neutral dot icon. */
  dir: Direction | null;
}

/**
 * The plain words of a Scan activity row. `send` reads from the row's category (sent or
 * received); anything Scan adds later falls back to "Transaction"; a failed row says so.
 */
export function wordsFor(row: WordsInput): string {
  return lookFor(row).words;
}

/** Words, icon and arrow of a row; an unknown kind reads "Transaction" with a dot and no arrow. */
export function lookFor(row: WordsInput): RowLook {
  const look = lookOf(row);
  const text = t(look?.word ?? 'activity.word.fallback');
  return {
    words: row.success ? text : t('activity.failed', { what: text }),
    icon: look?.icon ?? 'dot',
    dir: look?.dir ?? null,
  };
}

function lookOf(row: WordsInput): Look | undefined {
  if (row.kind === 'send') return row.category === 'received' ? RECEIVED : SENT;
  const entry = Object.hasOwn(LOOKS, row.kind) ? LOOKS[row.kind] : undefined;
  if (entry === undefined || 'word' in entry) return entry;
  return row.isSigner ? entry.signer : entry.other;
}
