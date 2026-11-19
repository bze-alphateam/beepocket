import type { ComponentChildren } from 'preact';

export interface TagProps {
  /** `accent`: soft kit colours (OPEN). `bad`: status red (FAILED). `warn`: amber (LOOK-ALIKE). */
  tone?: 'accent' | 'bad' | 'warn' | undefined;
  children: ComponentChildren;
}

/** A small uppercase status label next to a row title (`W-Activity`: OPEN, FAILED). */
export function Tag({ tone = 'accent', children }: TagProps) {
  return <span class={`bp-tag bp-tag-${tone}`}>{children}</span>;
}
