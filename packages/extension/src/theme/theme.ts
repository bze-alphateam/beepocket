import { alpha, mix } from './color';
import type { Kit, Scheme } from './kits';

export type CssVars = Record<string, string>;

/**
 * CSS custom properties for a kit. Surfaces, borders, muted text and gradients are mixed from
 * the kit's colours; status colours (ok / bad / warn) are fixed and never follow a token.
 */
export function buildCssVars(k: Kit, scheme: Scheme): CssVars {
  const light = scheme === 'light';
  const card = light ? mix(k.bg, '#FFFFFF', 0.75) : mix(k.bg, k.text, 0.045);
  const ok = light ? '#0E8A5A' : '#34D399';
  const bad = light ? '#C93636' : '#F87171';
  const warn = light ? '#B45309' : '#FCD34D';
  return {
    '--bp-bg': k.bg,
    '--bp-text': k.text,
    '--bp-card': card,
    '--bp-inset': light ? mix(k.bg, k.text, 0.05) : mix(k.bg, k.text, 0.08),
    '--bp-raised': light ? '#FFFFFF' : mix(k.bg, k.text, 0.12),
    '--bp-line': alpha(k.text, light ? 0.1 : 0.09),
    '--bp-line-strong': alpha(k.text, light ? 0.18 : 0.16),
    '--bp-text-soft': mix(k.text, k.bg, 0.15),
    '--bp-muted': mix(k.text, k.bg, light ? 0.36 : 0.32),
    '--bp-faint': mix(k.text, k.bg, light ? 0.42 : 0.46),
    '--bp-primary': k.primary,
    '--bp-secondary': k.secondary,
    '--bp-end': k.end,
    '--bp-grad': `linear-gradient(135deg,${k.primary},${k.end})`,
    '--bp-btn-text': k.bg,
    '--bp-btn-glow': `0 10px 26px -12px ${alpha(k.primary, light ? 0.45 : 0.7)}`,
    '--bp-soft': alpha(k.primary, light ? 0.08 : 0.12),
    '--bp-soft-line': alpha(k.primary, light ? 0.35 : 0.38),
    '--bp-accent-text': light ? k.primary : mix(k.primary, k.text, 0.3),
    '--bp-edge': `linear-gradient(${card},${card}) padding-box, linear-gradient(160deg,${alpha(k.primary, light ? 0.6 : 0.75)},${alpha(k.secondary, light ? 0.16 : 0.22)} 45%,${alpha(k.text, 0.06)}) border-box`,
    '--bp-glow': `radial-gradient(120% 75% at 50% -10%,${alpha(k.primary, light ? 0.16 : 0.24)} 0%,${alpha(k.end, light ? 0.05 : 0.07)} 45%,transparent 75%)`,
    // Also the empty part of progress bars and strength meters.
    '--bp-switch-off': light ? '#D5DAE1' : mix(k.bg, k.text, 0.12),
    '--bp-seg-on': light ? '#FFFFFF' : mix(k.bg, k.text, 0.12),
    '--bp-secondary-fill': light ? '#FFFFFF' : alpha(k.text, 0.04),
    '--bp-box-off': alpha(k.text, light ? 0.28 : 0.22),
    '--bp-pick-line': alpha(k.primary, 0.6),
    '--bp-row-on': alpha(k.text, 0.03),
    '--bp-swatch-line': alpha(k.text, 0.2),
    '--bp-veil': alpha(k.bg, 0.35),
    '--bp-mark-shadow': light
      ? `0 14px 22px ${alpha(k.primary, 0.22)}`
      : `0 14px 26px ${alpha(k.primary, 0.32)}`,
    '--bp-disc': light ? '#0F1318' : '#1B2128',
    '--bp-backdrop': light ? 'rgba(20,23,28,0.45)' : 'rgba(0,0,0,0.6)',
    '--bp-shadow': light
      ? '0 -24px 60px -24px rgba(20,23,28,0.35)'
      : '0 -24px 60px -20px rgba(0,0,0,0.8)',
    '--bp-ok': ok,
    '--bp-ok-text': light ? ok : '#6EE7B7',
    '--bp-bad': bad,
    '--bp-bad-text': light ? bad : '#FCA5A5',
    '--bp-bad-soft': alpha(bad, 0.08),
    '--bp-bad-line': alpha(bad, 0.3),
    '--bp-warn-text': warn,
    '--bp-warn-soft': alpha(warn, 0.1),
    '--bp-warn-line': alpha(warn, 0.32),
    '--bp-link': light ? '#0B74A8' : '#22C4E2',
  };
}
