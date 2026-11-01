import type { ComponentChildren } from 'preact';

export interface LayoutProps {
  /** Header slot: token selector, lock button and so on; features fill it. */
  header?: ComponentChildren;
  children: ComponentChildren;
}

/** The 360 × 600 popup frame: themed background, glow, header slot and a scrolling body. */
export function Layout({ header, children }: LayoutProps) {
  return (
    <div class="bp-frame">
      <div class="bp-glow" aria-hidden="true" />
      {header !== undefined && <header class="bp-header">{header}</header>}
      <div class="bp-body">{children}</div>
    </div>
  );
}
