import type { ComponentChildren } from 'preact';

export interface NoticeCardProps {
  /** An `Avatar` (the token of a link, the waiting site) or an `IconTile`. */
  leading: ComponentChildren;
  title: string;
  sub?: string | undefined;
  /** `plain` hairline (Welcome link strip) or `soft` accent outline (a site waiting on Unlock). */
  tone?: 'plain' | 'soft' | undefined;
  /** `status` for news the screen reader should hear (a site waiting); none by default. */
  role?: 'status' | 'note' | undefined;
}

/** A small card with an avatar and two lines (`Ob-Welcome-Link`, `Ob-Unlock-Request`). */
export function NoticeCard({ leading, title, sub, tone = 'plain', role }: NoticeCardProps) {
  return (
    <div class={`bp-notice bp-notice-${tone}`} role={role}>
      {leading}
      <span class="bp-notice-text">
        <span class="bp-notice-title">{title}</span>
        {sub !== undefined && <span class="bp-notice-sub">{sub}</span>}
      </span>
    </div>
  );
}
