import type { ComponentChildren } from 'preact';

export interface LayoutProps {
  /**
   * Header slot: a kit header (`ScreenHeader`, `OnboardingHeader`, `HomeHeader`) or the old
   * free-form header content, which gets the 64 px header row.
   */
  header?: ComponentChildren;
  /** A control pinned to the top-right corner of a screen without a header (Welcome, Unlock). */
  corner?: ComponentChildren;
  /** Pinned under the scrolling body: the screen's `BottomActions`. */
  footer?: ComponentChildren;
  /** The first-run boards use a taller glow (340 px) than the wallet (320 px). */
  glow?: 'wallet' | 'tall';
  children: ComponentChildren;
}

/** The 360 × 600 popup frame: themed background, glow, header, scrolling body and footer. */
export function Layout({ header, corner, footer, glow = 'wallet', children }: LayoutProps) {
  return (
    <div class="bp-frame">
      <div class={glow === 'tall' ? 'bp-glow bp-glow-tall' : 'bp-glow'} aria-hidden="true" />
      {corner !== undefined && <div class="bp-corner">{corner}</div>}
      {header !== undefined && <header class="bp-header">{header}</header>}
      <div class="bp-body">{children}</div>
      {footer !== undefined && <footer class="bp-footer">{footer}</footer>}
    </div>
  );
}
