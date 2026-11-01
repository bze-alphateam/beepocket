import { describe, expect, it } from 'vitest';
import { wordsFor } from './words';

const row = (kind: string, over: Partial<Parameters<typeof wordsFor>[0]> = {}) => ({
  kind,
  category: 'other',
  isSigner: true,
  success: true,
  ...over,
});

/** Every kind Scan's classify tables emit (messages and block events). */
const KINDS = [
  'send',
  'nft_send',
  'vesting_create',
  'delegate',
  'undelegate',
  'redelegate',
  'cancel_unbonding',
  'validator',
  'claim_rewards',
  'claim_commission',
  'withdraw_address',
  'community_pool_fund',
  'validator_rewards_deposit',
  'proposal',
  'proposal_deposit',
  'vote',
  'proposal_cancel',
  'authz_exec',
  'authz_grant',
  'authz_revoke',
  'feegrant_grant',
  'feegrant_revoke',
  'feegrant_prune',
  'group',
  'dex_order',
  'dex_cancel',
  'dex_fill',
  'dex_swap',
  'liquidity',
  'dex_pool',
  'dex_market',
  'burner_fund',
  'raffle_join',
  'raffle_start',
  'burner_move',
  'token_create',
  'token_mint',
  'token_burn',
  'token_admin',
  'token_update',
  'reward_join',
  'reward_exit',
  'reward_claim',
  'reward_program',
  'article',
  'respect',
  'dex_order_saved',
  'dex_refund',
  'dex_cancel_skipped',
  'dex_failed',
  'unbonding_completed',
  'redelegation_completed',
  'reward_won',
  'raffle_won',
  'raffle_lost',
  'raffle_finished',
  'burned',
  'slashed',
  'proposal_resolved',
  'proposal_dropped',
  'epoch',
  'relay',
  'ibc_in',
  'ibc_refund',
  'fee_only',
];

describe('wordsFor', () => {
  it('has words for every documented kind, none of them the fallback', () => {
    for (const kind of KINDS) {
      expect(wordsFor(row(kind)), kind).not.toBe('Transaction');
      expect(wordsFor(row(kind)), kind).not.toBe('');
    }
  });

  it('reads a send from its category', () => {
    expect(wordsFor(row('send', { category: 'sent' }))).toBe('Sent');
    expect(wordsFor(row('send', { category: 'received', isSigner: false }))).toBe('Received');
  });

  it('reads the two sides of an NFT send, a vesting account, an article and respect', () => {
    expect(wordsFor(row('nft_send'))).toBe('Sent an NFT');
    expect(wordsFor(row('nft_send', { isSigner: false }))).toBe('Received an NFT');
    expect(wordsFor(row('vesting_create'))).toBe('Created a vesting account');
    expect(wordsFor(row('vesting_create', { isSigner: false }))).toBe('Received a vesting account');
    expect(wordsFor(row('article'))).toBe('Added an article');
    expect(wordsFor(row('article', { isSigner: false }))).not.toBe('Added an article');
    expect(wordsFor(row('respect'))).toBe('Paid respect');
    expect(wordsFor(row('respect', { isSigner: false }))).toBe('Received respect');
  });

  it('says what a swap and an order are', () => {
    expect(wordsFor(row('dex_swap'))).toBe('Swapped');
    expect(wordsFor(row('dex_order'))).toBe('Placed an order');
  });

  it('falls back to "Transaction" for an unknown kind, "other" and inherited names', () => {
    expect(wordsFor(row('brand_new_kind'))).toBe('Transaction');
    expect(wordsFor(row('other'))).toBe('Transaction');
    expect(wordsFor(row('constructor'))).toBe('Transaction');
  });

  it('prefixes a failed row', () => {
    expect(wordsFor(row('dex_swap', { success: false }))).toBe('Failed: Swapped');
    expect(wordsFor(row('mystery', { success: false }))).toBe('Failed: Transaction');
  });
});
