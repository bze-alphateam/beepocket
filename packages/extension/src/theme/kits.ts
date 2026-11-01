import type { DenomBranding, Palette } from '@beepocket/core';
import { contrast, isHexColor, mix } from './color';

export type Scheme = 'light' | 'dark';

/** The four colours everything else is mixed from, plus the gradient end of the primary. */
export interface Kit {
  bg: string;
  text: string;
  primary: string;
  secondary: string;
  end: string;
}

export const BZE_DENOM = 'ubze';

type KitPair = Record<Scheme, Kit>;

/** BeePocket's own look: Hive Glow neutrals with Communities green. */
const BEEPOCKET: KitPair = {
  dark: {
    bg: '#0A0C10',
    text: '#E8ECF2',
    primary: '#3DD07A',
    secondary: '#8A94A3',
    end: '#1E9150',
  },
  light: {
    bg: '#F5F7FA',
    text: '#14171C',
    primary: '#1A7A43',
    secondary: '#5B6472',
    end: '#14603A',
  },
};

/** BZE keeps its own blue kit. */
const BZE: KitPair = {
  dark: {
    bg: '#0A0C10',
    text: '#E8ECF2',
    primary: '#33C3E0',
    secondary: '#8A94A3',
    end: '#0094C5',
  },
  light: {
    bg: '#F5F7FA',
    text: '#14171C',
    primary: '#007AA3',
    secondary: '#5B6472',
    end: '#005F80',
  },
};

export interface KitInput {
  /** Base denom the wallet is showing, or null. */
  denom: string | null;
  /** The token's on-chain brand kit, or null when it has none. */
  branding: DenomBranding | null;
  /** The `brandThemes` setting: off means always the BeePocket look. */
  brandThemes: boolean;
}

function validPalette(p: Palette | undefined): p is Palette {
  return (
    typeof p === 'object' &&
    isHexColor(p.background) &&
    isHexColor(p.text) &&
    isHexColor(p.primary) &&
    isHexColor(p.secondary)
  );
}

/** Chain data may be unreadable: text on the background, and button text on the whole gradient. */
export const MIN_CONTRAST = 3;

function readable(k: Kit): boolean {
  return (
    contrast(k.text, k.bg) >= MIN_CONTRAST &&
    contrast(k.bg, k.primary) >= MIN_CONTRAST &&
    contrast(k.bg, k.end) >= MIN_CONTRAST
  );
}

/** Picks the kit for a scheme: branding, else the denom's built-in kit, else BeePocket's. */
export function resolveKit(input: KitInput, scheme: Scheme): Kit {
  if (!input.brandThemes) return BEEPOCKET[scheme];
  const palette = input.branding?.[scheme];
  if (validPalette(palette)) {
    const kit: Kit = {
      bg: palette.background,
      text: palette.text,
      primary: palette.primary,
      secondary: palette.secondary,
      end: mix(palette.primary, '#000000', 0.25),
    };
    if (readable(kit)) return kit;
  }
  return input.denom === BZE_DENOM ? BZE[scheme] : BEEPOCKET[scheme];
}
