import { en, type StringKey } from './en';

export { en, type StringKey } from './en';

export type StringParams = Record<string, string | number>;

/** Looks up a string and fills `{name}` placeholders; a missing parameter is left in place. */
export function t(key: StringKey, params?: StringParams): string {
  const text: string = en[key];
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : whole,
  );
}
