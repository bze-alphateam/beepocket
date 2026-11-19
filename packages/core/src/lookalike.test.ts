import { describe, expect, it } from 'vitest';
import { foldConfusable, isLookalike, labelText, sameLook, tokenLabel } from './index';

const FAKE = 'factory/bze1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq/fake';
const ATOM = `ibc/${'5F'.repeat(32)}`;
const VERIFIED = [{ denom: ATOM, symbol: 'ATOM' }];

describe('foldConfusable', () => {
  it.each([
    ['plain', 'BZE'],
    ['lower case', 'bze'],
    ['Greek capitals', 'ΒΖΕ'],
    ['Cyrillic capitals', 'ВZЕ'],
    ['fullwidth', 'ＢＺＥ'],
    ['mathematical bold', '𝐁𝐙𝐄'],
    ['small capitals', 'ʙᴢᴇ'],
    ['a zero-width space inside', 'B​ZE'],
    ['bidi controls around', '‮BZE‬'],
    ['an accent', 'BŽE'],
    ['dots between letters', 'B.Z.E'],
    ['spaces between letters', 'B Z E'],
  ])('folds %s to the same form as BZE', (_name, text) => {
    expect(foldConfusable(text)).toBe(foldConfusable('BZE'));
  });

  it('keeps different words apart', () => {
    expect(foldConfusable('BZE')).not.toBe(foldConfusable('BZD'));
    expect(foldConfusable('ATOM')).not.toBe(foldConfusable('ATOMS'));
  });

  it('folds look-alike letters and digits of other symbols', () => {
    expect(foldConfusable('АТОМ')).toBe(foldConfusable('ATOM'));
    expect(foldConfusable('AT0M')).toBe(foldConfusable('ATOM'));
    expect(foldConfusable('USDС')).toBe(foldConfusable('USDC'));
    expect(foldConfusable('VDI')).toBe(foldConfusable('VDL'));
  });
});

describe('sameLook', () => {
  it('compares folded forms and never matches empty text', () => {
    expect(sameLook('Gold', 'ＧＯＬＤ')).toBe(true);
    expect(sameLook('Gold', 'Silver')).toBe(false);
    expect(sameLook('...', '​')).toBe(false);
  });
});

describe('isLookalike', () => {
  const token = (symbol: string, name = symbol, denom = FAKE) => ({ denom, symbol, name });

  it('never flags the native coin', () => {
    expect(isLookalike(token('BZE', 'BeeZee', 'ubze'), [])).toBe(false);
  });

  it.each(['BZE', 'ΒΖΕ', 'ＢＺＥ', 'bze', 'BeeZee', 'Ｂｅｅｚｅｅ'])(
    'flags any other token whose symbol is like BZE (%s)',
    (symbol) => {
      expect(isLookalike(token(symbol, 'Some coin'), [])).toBe(true);
    },
  );

  it('flags a token whose name is like BeeZee, whatever its symbol', () => {
    expect(isLookalike(token('XYZ', 'BeeZee'), [])).toBe(true);
    expect(isLookalike(token('XYZ', 'BZE'), [])).toBe(true);
  });

  it('flags BZE look-alikes even when they are on the verified list', () => {
    expect(isLookalike(token('BZE'), [{ denom: FAKE, symbol: 'BZE' }])).toBe(true);
  });

  it("flags an unverified token that looks like a verified token's symbol", () => {
    expect(isLookalike(token('ATOM'), VERIFIED)).toBe(true);
    expect(isLookalike(token('АТОМ'), VERIFIED)).toBe(true);
  });

  it('does not flag the verified token itself', () => {
    expect(isLookalike(token('ATOM', 'Cosmos Hub', ATOM), VERIFIED)).toBe(false);
  });

  it('leaves an unverified token that resembles nothing alone', () => {
    expect(isLookalike(token('GOLD', 'Gold Coin'), VERIFIED)).toBe(false);
  });
});

describe('tokenLabel', () => {
  it('keeps the plain symbol, with no tail, for a token that is not flagged', () => {
    const label = tokenLabel({ denom: FAKE, symbol: 'GOLD' });
    expect(label).toEqual({ symbol: 'GOLD', tail: null, lookalike: false });
    expect(labelText(label)).toBe('GOLD');
  });

  it('adds a short denom tail to a flagged token', () => {
    const label = tokenLabel({ denom: FAKE, symbol: 'BZE', lookalike: true });
    expect(label.lookalike).toBe(true);
    expect(label.tail).toMatch(/^factory\/bze1q+…q+\/fake$/);
    expect(labelText(label)).toBe(`BZE (look-alike, ${label.tail ?? ''})`);
  });

  it('shortens an IBC hash in the tail', () => {
    const label = tokenLabel({ denom: ATOM, symbol: 'ATOM', lookalike: true });
    expect(label.tail).toBe('ibc/5F5F…5F5F');
  });

  it('cleans the symbol', () => {
    expect(tokenLabel({ denom: FAKE, symbol: 'GO‮LD' }).symbol).toBe('GOLD');
  });
});
