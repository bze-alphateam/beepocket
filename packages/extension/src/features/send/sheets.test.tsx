import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FeeChoice, FeeOverride } from '../../protocol/send';
import { cleanup, fireEvent, render } from '../../ui/test-render';
import { feeKey, FeeSheet } from './Sheets';

afterEach(cleanup);

const LOOKALIKE = 'factory/bze1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq/ubzefake';
const own: FeeChoice = {
  denom: 'ubze',
  amount: '2000',
  gasLimit: '200000',
  gasUsed: '166666',
  symbol: 'BZE',
  decimals: 6,
};
const site: FeeChoice = {
  denom: LOOKALIKE,
  amount: '5000',
  gasLimit: '250000',
  gasUsed: '166666',
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

const NATIVE_PRICING = {
  native: true,
  nativePrice: { num: '1', den: '100' },
  rate: { num: '1', den: '100' },
};
// 166,666 simulated: the BZE estimate is 200,000 gas for 2,000 ubze at 0.01 ubze per gas.
const priced: FeeChoice = { ...own, balance: '100000000', pricing: NATIVE_PRICING };

const gasField = (host: HTMLElement): HTMLInputElement => {
  const label = [...host.querySelectorAll('label')].find((l) => l.textContent === 'Gas limit');
  const input =
    label && host.querySelector<HTMLInputElement>(`#${label.getAttribute('for') ?? ''}`);
  if (!input) throw new Error('no gas limit field');
  return input;
};
const typeGas = (host: HTMLElement, value: string) => {
  const input = gasField(host);
  input.value = value;
  fireEvent(input, 'input');
};
const byText = (host: HTMLElement, text: string): HTMLButtonElement => {
  const b = [...host.querySelectorAll('button')].find((x) => x.textContent.trim() === text);
  if (!b) throw new Error(`no button ${text}`);
  return b;
};
/** A gas price pick: its labels (×2) repeat the quick picks', so look only among the prices. */
const priceButton = (host: HTMLElement, text: string): HTMLButtonElement => {
  const b = [...host.querySelectorAll('.bp-gas-prices button')].find(
    (x) => x.textContent.trim() === text,
  );
  if (!(b instanceof HTMLButtonElement)) throw new Error(`no price ${text}`);
  return b;
};
const feeLine = (host: HTMLElement) => host.querySelector('.bp-gas-fee strong')?.textContent;

function advancedSheet(
  options: {
    option?: FeeChoice;
    applied?: FeeOverride | null;
    spendable?: bigint;
    prefill?: string;
  } = {},
) {
  const onApply = vi.fn();
  const option = options.option ?? priced;
  const { host } = render(
    <FeeSheet
      open
      options={[option]}
      selected={feeKey(option)}
      onPick={() => undefined}
      onClose={() => undefined}
      advanced={{
        applied: options.applied ?? null,
        spendable: () => options.spendable ?? 100_000_000n,
        holder: 'Main',
        onApply,
        prefill: options.prefill,
      }}
    />,
  );
  return { host, onApply };
}
const openAdvanced = (host: HTMLElement) => {
  const row = [...host.querySelectorAll('button')].find((b) =>
    b.getAttribute('aria-label')?.startsWith('Advanced'),
  );
  fireEvent(row, 'click');
};

describe('FeeSheet Advanced', () => {
  it('opens from the last row on the estimate and prices any limit and price live', () => {
    const { host, onApply } = advancedSheet();
    expect(host.textContent).toContain('Gas limit 200,000');
    openAdvanced(host);
    expect(host.querySelector('h2')?.textContent).toBe('Advanced');
    expect(host.textContent).toContain('Paid in BZE');
    expect(host.textContent).toContain("Auto = BeePocket's estimate, 200,000 · simulated 166,666");
    expect(gasField(host).value).toBe('200,000');
    expect(feeLine(host)).toBe('≈ 0.002 BZE');
    typeGas(host, '300,000');
    expect(feeLine(host)).toBe('≈ 0.003 BZE');
    fireEvent(priceButton(host, '×2'), 'click');
    expect(priceButton(host, '×2').getAttribute('aria-checked')).toBe('true');
    expect(host.textContent).toContain('0.02 ubze per gas');
    expect(feeLine(host)).toBe('≈ 0.006 BZE');
    fireEvent(byText(host, 'Done'), 'click');
    expect(onApply).toHaveBeenCalledWith({ gasLimit: '300000', gasPrice: 2 });
  });

  it('gives back no settings when the estimate and the minimum price are kept', () => {
    const { host, onApply } = advancedSheet({ applied: { gasLimit: '300000', gasPrice: 2 } });
    expect(host.textContent).toContain('Gas 300,000 · custom');
    openAdvanced(host);
    fireEvent(byText(host, 'Auto'), 'click');
    fireEvent(priceButton(host, 'Minimum'), 'click');
    fireEvent(byText(host, 'Done'), 'click');
    expect(onApply).toHaveBeenCalledWith(null);
  });

  it('warns below the estimate and refuses below the simulation, above the cap or the balance', () => {
    const { host } = advancedSheet({ spendable: 5_000n });
    openAdvanced(host);
    const done = () => byText(host, 'Done').disabled;
    typeGas(host, '180000');
    expect(host.textContent).toContain('Below the estimate of 200,000');
    expect(done()).toBe(false);
    typeGas(host, '166665');
    expect(host.textContent).toContain('At least 166,666, the gas the simulation used.');
    expect(gasField(host).getAttribute('aria-invalid')).toBe('true');
    expect(feeLine(host)).toBe('—');
    expect(done()).toBe(true);
    typeGas(host, '2000001');
    expect(host.textContent).toContain('At most 2,000,000, 10× the estimate.');
    expect(done()).toBe(true);
    // 600,000 gas is 6,000 ubze: more than the 5,000 that may be spent.
    typeGas(host, '600000');
    expect(host.textContent).toContain('Main holds 0.005 BZE, too little for this fee.');
    expect(done()).toBe(true);
    typeGas(host, '');
    expect(host.textContent).toContain('Enter a gas limit, or pick Auto.');
    expect(done()).toBe(true);
  });

  it('offers quick picks from the estimate and turns off the ones the balance cannot pay', () => {
    const { host } = advancedSheet({ spendable: 5_000n });
    openAdvanced(host);
    expect(byText(host, 'Auto').getAttribute('aria-pressed')).toBe('true');
    fireEvent(byText(host, '×1.5'), 'click');
    expect(gasField(host).value).toBe('300,000');
    fireEvent(byText(host, '×2'), 'click');
    expect(gasField(host).value).toBe('400,000');
    // x5 is 1,000,000 gas (10,000 ubze) and Max 2,000,000: both above the 5,000 left.
    expect(byText(host, '×5').disabled).toBe(true);
    expect(byText(host, 'Max').disabled).toBe(true);
  });

  it("starts a site's fee from its own gas and says that changing it replaces the fee", () => {
    const siteFee: FeeChoice = {
      ...priced,
      amount: '1200',
      gasLimit: '120000',
      setBy: 'https://dex.example',
    };
    const { host, onApply } = advancedSheet({ option: siteFee });
    expect(host.textContent).toContain('Gas 120,000 · set by site');
    openAdvanced(host);
    expect(feeLine(host)).toBe('≈ 0.0012 BZE');
    expect(host.textContent).toContain(
      'https://dex.example set 120,000, below the simulated 166,666. It may run out of gas.',
    );
    fireEvent(byText(host, 'Auto'), 'click');
    expect(host.textContent).toContain('This replaces the fee https://dex.example set.');
    expect(feeLine(host)).toBe('≈ 0.002 BZE');
    fireEvent(byText(host, 'Done'), 'click');
    expect(onApply).toHaveBeenCalledWith({ gasLimit: '200000', gasPrice: 1 });
  });

  // The site's 195,000 is under the wallet's 200,000 estimate but above the 166,666 simulated:
  // its own simulation's margin, no reason to warn. Its 2,500 ubze is not 195,000 x 0.01.
  const siteBelowEstimate: FeeChoice = {
    ...priced,
    amount: '2500',
    gasLimit: '195000',
    setBy: 'https://dex.example',
  };
  const SITE_HELP = 'Set by https://dex.example · Auto would be 200,000';
  const BELOW = 'Below the estimate of 200,000';
  const warned = (host: HTMLElement) =>
    host.querySelector('.bp-gas-note') !== null || host.querySelector('.bp-gas-warn') !== null;

  it("keeps a site's gas limit the site's when only the gas price changes", () => {
    const { host, onApply } = advancedSheet({ option: siteBelowEstimate });
    openAdvanced(host);
    expect(host.textContent).toContain(SITE_HELP);
    expect(feeLine(host)).toBe('≈ 0.0025 BZE');
    fireEvent(priceButton(host, '×2'), 'click');
    expect(gasField(host).value).toBe('195,000');
    expect(host.textContent).toContain(SITE_HELP);
    expect(host.textContent).not.toContain(BELOW);
    expect(warned(host)).toBe(false);
    // The site's limit at the new price: 195,000 x 0.02 = 3,900 ubze.
    expect(feeLine(host)).toBe('≈ 0.0039 BZE');
    expect(host.textContent).toContain('This replaces the fee https://dex.example set.');
    fireEvent(priceButton(host, '×3'), 'click');
    expect(host.textContent).toContain(SITE_HELP);
    expect(warned(host)).toBe(false);
    expect(feeLine(host)).toBe('≈ 0.00585 BZE');
    fireEvent(byText(host, 'Done'), 'click');
    expect(onApply).toHaveBeenCalledWith({ gasLimit: '195000', gasPrice: 3 });
  });

  it("gives the site's own fee back when the price returns to the minimum", () => {
    const { host, onApply } = advancedSheet({
      option: siteBelowEstimate,
      applied: { gasLimit: '195000', gasPrice: 2 },
    });
    // The list's Advanced row: the gas limit is still the site's.
    expect(host.textContent).toContain('Gas 195,000 · set by site');
    expect(host.textContent).not.toContain('195,000 · custom');
    openAdvanced(host);
    expect(feeLine(host)).toBe('≈ 0.0039 BZE');
    fireEvent(priceButton(host, 'Minimum'), 'click');
    // The site's 2,500, not a recomputed 1,950.
    expect(feeLine(host)).toBe('≈ 0.0025 BZE');
    expect(host.textContent).toContain('Only change these if a transaction failed.');
    fireEvent(byText(host, 'Done'), 'click');
    expect(onApply).toHaveBeenCalledWith(null);
  });

  it("warns below the estimate only for a limit the user picked or typed on a site's fee", () => {
    const { host } = advancedSheet({ option: siteBelowEstimate });
    openAdvanced(host);
    fireEvent(priceButton(host, '×2'), 'click');
    const picks: [string, string][] = [
      ['Auto', '200,000'],
      ['×1.5', '300,000'],
      ['×2', '400,000'],
      ['×5', '1,000,000'],
      ['Max', '2,000,000'],
    ];
    for (const [pick, gas] of picks) {
      fireEvent(byText(host, pick), 'click');
      expect(gasField(host).value).toBe(gas);
      expect(warned(host)).toBe(false);
      expect(host.textContent).toContain("Auto = BeePocket's estimate, 200,000");
    }
    typeGas(host, '180000');
    expect(host.textContent).toContain(BELOW);
    expect(warned(host)).toBe(true);
    // Typing the site's own limit again gives it back to the site.
    typeGas(host, '195000');
    expect(host.textContent).toContain(SITE_HELP);
    expect(warned(host)).toBe(false);
    expect(feeLine(host)).toBe('≈ 0.0039 BZE');
  });

  it("refuses a new price on a site's limit below the simulated gas", () => {
    const tooLow: FeeChoice = { ...siteBelowEstimate, amount: '1200', gasLimit: '120000' };
    const { host } = advancedSheet({ option: tooLow });
    openAdvanced(host);
    expect(host.textContent).toContain('https://dex.example set 120,000, below the simulated');
    fireEvent(priceButton(host, '×2'), 'click');
    expect(host.textContent).toContain('At least 166,666, the gas the simulation used.');
    expect(byText(host, 'Done').disabled).toBe(true);
  });

  it('opens straight on Advanced with a prefilled limit ("Raise gas")', () => {
    const { host } = advancedSheet({ prefill: '200000' });
    expect(host.querySelector('h2')?.textContent).toBe('Advanced');
    expect(gasField(host).value).toBe('200,000');
  });

  it('shows a gas price that is not a decimal fraction exactly, rounded up at 18 digits', () => {
    const thirds = { num: '1', den: '3' };
    const { host } = advancedSheet({
      option: { ...priced, pricing: { native: true, nativePrice: thirds, rate: thirds } },
    });
    openAdvanced(host);
    expect(host.textContent).toContain('0.333333333333333334 ubze per gas · chain minimum');
    fireEvent(priceButton(host, '×3'), 'click');
    expect(host.textContent).toContain('1.00 ubze per gas');
  });

  it('has no Advanced row for a token it cannot price', () => {
    const { host } = advancedSheet({ option: own });
    expect(host.textContent).not.toContain('Advanced');
  });
});
