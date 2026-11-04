import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FeeChoice } from '../../protocol/send';
import { cleanup, fireEvent, render } from '../../ui/test-render';
import { feeKey, FeeSheet } from './Sheets';

afterEach(cleanup);

const LOOKALIKE = 'factory/bze1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq/ubzefake';
const own: FeeChoice = {
  denom: 'ubze',
  amount: '2000',
  gasLimit: '200000',
  symbol: 'BZE',
  decimals: 6,
};
const site: FeeChoice = {
  denom: LOOKALIKE,
  amount: '5000',
  gasLimit: '250000',
  symbol: 'BZE',
  decimals: 6,
  setBy: 'https://dex.example',
};

describe('FeeSheet with a fee a site set', () => {
  it('shows the sites origin, its short denom and its gas limit, so a borrowed symbol stands out', () => {
    const { host } = render(
      <FeeSheet
        open
        options={[site, own]}
        selected={feeKey(site)}
        onPick={() => undefined}
        onClose={() => undefined}
      />,
    );
    const text = host.textContent;
    expect(text).toContain('Set by https://dex.example · factory/…/ubzefake · gas 250,000');
    // The wallet's own option in real BZE carries no such line.
    expect(text.match(/Set by/g)).toHaveLength(1);
  });

  it('keeps the sites option apart from the wallets own option in the same token', () => {
    const onPick = vi.fn();
    const sameToken: FeeChoice = { ...site, denom: 'ubze' };
    const { host } = render(
      <FeeSheet
        open
        options={[sameToken, own]}
        selected={feeKey(sameToken)}
        onPick={onPick}
        onClose={() => undefined}
      />,
    );
    expect(host.textContent).toContain('Set by https://dex.example · ubze · gas 250,000');
    const rows = [...host.querySelectorAll('button')].filter((b) =>
      b.getAttribute('aria-label')?.startsWith('BZE,'),
    );
    expect(rows).toHaveLength(2);
    fireEvent(rows[1], 'click');
    expect(onPick).toHaveBeenCalledWith('ubze');
    expect(feeKey(sameToken)).not.toBe(feeKey(own));
  });
});
