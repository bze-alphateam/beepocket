import type { DenomBranding } from '@beepocket/core';
import { describe, expect, it } from 'vitest';
import { applyTheme, systemScheme, themeVars, type ThemeInput } from '.';

const branding: DenomBranding = {
  font: 'inter',
  dark: { background: '#1A0F0B', text: '#FFEDD5', primary: '#FB923C', secondary: '#F9A8D4' },
  light: { background: '#FFF7ED', text: '#1F1410', primary: '#C2410C', secondary: '#9F1239' },
};

const base: ThemeInput = { denom: null, branding: null, brandThemes: true, scheme: 'dark' };
const STATUS = ['--bp-ok', '--bp-ok-text', '--bp-bad', '--bp-bad-text', '--bp-warn-text'];

describe('themeVars', () => {
  it('maps a dark brand kit to variables', () => {
    const v = themeVars({ ...base, denom: 'factory/x/PAGE', branding });
    expect(v['--bp-bg']).toBe('#1A0F0B');
    expect(v['--bp-text']).toBe('#FFEDD5');
    expect(v['--bp-primary']).toBe('#FB923C');
    expect(v['--bp-secondary']).toBe('#F9A8D4');
    expect(v['--bp-grad']).toContain('#FB923C');
    expect(v['--bp-card']).toMatch(/^#[0-9a-f]{6}$/);
    expect(v['--bp-line']).toMatch(/^rgba\(255,237,213,/);
  });

  it('uses the light palette in the light scheme', () => {
    const v = themeVars({ ...base, scheme: 'light', denom: 'factory/x/PAGE', branding });
    expect(v['--bp-bg']).toBe('#FFF7ED');
    expect(v['--bp-primary']).toBe('#C2410C');
    expect(v['--bp-raised']).toBe('#FFFFFF');
  });

  it('falls back to the BeePocket look without branding', () => {
    expect(themeVars(base)['--bp-primary']).toBe('#3DD07A');
    expect(themeVars(base)['--bp-end']).toBe('#1E9150');
    const light = themeVars({ ...base, scheme: 'light' });
    expect(light['--bp-primary']).toBe('#1A7A43');
    expect(light['--bp-end']).toBe('#14603A');
  });

  it('gives ubze its own blue kit', () => {
    const dark = themeVars({ ...base, denom: 'ubze' });
    expect(dark['--bp-primary']).toBe('#33C3E0');
    expect(dark['--bp-end']).toBe('#0094C5');
    const light = themeVars({ ...base, denom: 'ubze', scheme: 'light' });
    expect(light['--bp-primary']).toBe('#007AA3');
    expect(light['--bp-end']).toBe('#005F80');
  });

  it('always uses the BeePocket look when brand themes are off', () => {
    for (const denom of ['ubze', 'factory/x/PAGE']) {
      const v = themeVars({ ...base, denom, branding, brandThemes: false });
      expect(v).toEqual(themeVars(base));
    }
  });

  it.each(['red', '#FFF', '#GGGGGG', 'url(x)', '#12345678', ''])(
    'rejects invalid colour %j from chain data',
    (bad) => {
      const broken = { ...branding, dark: { ...branding.dark, primary: bad } };
      expect(themeVars({ ...base, denom: 'factory/x/PAGE', branding: broken })).toEqual(
        themeVars(base),
      );
      expect(themeVars({ ...base, denom: 'ubze', branding: broken })['--bp-primary']).toBe(
        '#33C3E0',
      );
    },
  );

  it('falls back when the text is unreadable on the background', () => {
    const lowText = { ...branding, dark: { ...branding.dark, text: '#2A1A14' } };
    expect(themeVars({ ...base, denom: 'factory/x/PAGE', branding: lowText })).toEqual(
      themeVars(base),
    );
    const sameColours = { ...branding, dark: { ...branding.dark, text: '#1A0F0B' } };
    expect(themeVars({ ...base, denom: 'factory/x/PAGE', branding: sameColours })).toEqual(
      themeVars(base),
    );
  });

  it('falls back when button text would be unreadable on the primary', () => {
    // Primary almost the background colour: the button label (background colour) vanishes.
    const flat = { ...branding, dark: { ...branding.dark, primary: '#241610' } };
    expect(themeVars({ ...base, denom: 'factory/x/PAGE', branding: flat })).toEqual(
      themeVars(base),
    );
    // Same check in the light scheme.
    const flatLight = { ...branding, light: { ...branding.light, primary: '#FFF0DD' } };
    expect(
      themeVars({ ...base, scheme: 'light', denom: 'factory/x/PAGE', branding: flatLight }),
    ).toEqual(themeVars({ ...base, scheme: 'light' }));
  });

  it('keeps a kit whose colours are readable', () => {
    for (const scheme of ['dark', 'light'] as const) {
      const v = themeVars({ ...base, scheme, denom: 'factory/x/PAGE', branding });
      expect(v['--bp-primary']).toBe(branding[scheme].primary);
    }
  });

  it('keeps status colours the same for every token kit', () => {
    for (const scheme of ['dark', 'light'] as const) {
      const plain = themeVars({ ...base, scheme });
      const themed = themeVars({ ...base, scheme, denom: 'factory/x/PAGE', branding });
      const blue = themeVars({ ...base, scheme, denom: 'ubze' });
      for (const name of STATUS) {
        expect(themed[name]).toBe(plain[name]);
        expect(blue[name]).toBe(plain[name]);
      }
    }
  });
});

describe('applyTheme', () => {
  it('writes every variable and the scheme in one call', () => {
    const props = new Map<string, string>();
    const target = {
      style: { setProperty: (n: string, v: string) => props.set(n, v) },
      dataset: {} as { scheme?: string },
    };
    applyTheme(target, base);
    expect(props.get('--bp-primary')).toBe('#3DD07A');
    expect(target.dataset.scheme).toBe('dark');
    applyTheme(target, { ...base, denom: 'ubze', scheme: 'light' });
    expect(props.get('--bp-primary')).toBe('#007AA3');
    expect(target.dataset.scheme).toBe('light');
  });
});

describe('systemScheme', () => {
  it('follows prefers-color-scheme', () => {
    expect(systemScheme({ matches: true })).toBe('dark');
    expect(systemScheme({ matches: false })).toBe('light');
  });
});
