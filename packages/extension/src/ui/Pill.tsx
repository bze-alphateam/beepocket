import type { ComponentChildren } from 'preact';

export function Pill({ children }: { children: ComponentChildren }) {
  return <span class="bp-pill">{children}</span>;
}
