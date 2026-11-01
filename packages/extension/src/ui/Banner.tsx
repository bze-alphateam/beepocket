import type { ComponentChildren } from 'preact';

export interface BannerProps {
  tone: 'info' | 'amber' | 'red';
  children: ComponentChildren;
}

export function Banner({ tone, children }: BannerProps) {
  return (
    <div class={`bp-banner bp-banner-${tone}`} role={tone === 'red' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}
