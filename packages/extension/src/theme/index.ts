import { resolveKit, type KitInput, type Scheme } from './kits';
import { buildCssVars, type CssVars } from './theme';

export { isHexColor } from './color';
export { BZE_DENOM, resolveKit, type Kit, type KitInput, type Scheme } from './kits';
export { buildCssVars, type CssVars } from './theme';
export {
  AppearanceState,
  DEFAULT_APPEARANCE,
  isAppearance,
  resolveScheme,
  type Appearance,
  type SchemeQuery,
  type SchemeSource,
} from './appearance';

export interface ThemeInput extends KitInput {
  scheme: Scheme;
}

/** The variables for a token's theme in a colour scheme. */
export function themeVars(input: ThemeInput): CssVars {
  return buildCssVars(resolveKit(input, input.scheme), input.scheme);
}

/** The slice of an element `applyTheme` writes to (`document.documentElement`). */
export interface ThemeTarget {
  style: { setProperty(name: string, value: string): void };
  dataset: { scheme?: string | undefined };
}

/** Switching token or scheme is one call. */
export function applyTheme(target: ThemeTarget, input: ThemeInput): void {
  for (const [name, value] of Object.entries(themeVars(input))) {
    target.style.setProperty(name, value);
  }
  target.dataset.scheme = input.scheme;
}

/** The scheme the browser asks for (`prefers-color-scheme`). */
export function systemScheme(query: Pick<MediaQueryList, 'matches'>): Scheme {
  return query.matches ? 'dark' : 'light';
}
