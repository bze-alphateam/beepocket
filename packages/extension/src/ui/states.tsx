import type { ComponentChildren } from 'preact';
import { IconTile } from './Avatar';
import { Icon, type IconName } from './icons';

export interface EmptyStateProps {
  icon: IconName;
  title: string;
  sub?: string | undefined;
  /** `soft`: kit accent 52 px tile (no sites). `inset`: neutral 44 px tile (no activity). */
  tone?: 'soft' | 'inset' | undefined;
}

/** An icon tile, a title and a sub line, centred (`W-Sites-Empty`, `W-Activity-Empty`). */
export function EmptyState({ icon, title, sub, tone = 'soft' }: EmptyStateProps) {
  const big = tone === 'soft';
  return (
    <div class="bp-empty">
      <IconTile icon={icon} tone={tone} size={big ? 52 : 44} iconSize={big ? 24 : 20} />
      <p class="bp-empty-title">{title}</p>
      {sub !== undefined && <p class="bp-empty-sub">{sub}</p>}
    </div>
  );
}

export interface ResultLayoutProps {
  /** `ok` success disc, `bad` failure disc, `pending` the spinning ring. */
  status: 'ok' | 'bad' | 'pending';
  title: string;
  sub?: string | undefined;
  /** Accessible name of the pending ring ("Sending"). */
  pendingLabel?: string | undefined;
  /** Below the heading: the error card, the details `Card`. */
  children?: ComponentChildren;
  /** Under the details: the ghost Explorer link. */
  link?: ComponentChildren;
  /** Pinned at the bottom: primary over secondary. */
  actions?: ComponentChildren;
}

/** The result of a transaction: `W-Success`, `W-Failed`, `W-Pending`. */
export function ResultLayout(props: ResultLayoutProps) {
  if (props.status === 'pending') {
    return (
      <div class="bp-result bp-result-pending">
        <svg
          class="bp-result-ring"
          role="img"
          aria-label={props.pendingLabel ?? props.title}
          width="72"
          height="72"
          viewBox="0 0 72 72"
        >
          <circle cx="36" cy="36" r="30" />
          <circle cx="36" cy="36" r="30" stroke-dasharray="60 129" />
        </svg>
        <div class="bp-result-head">
          <h1>{props.title}</h1>
          {props.sub !== undefined && <p>{props.sub}</p>}
        </div>
        {props.children}
      </div>
    );
  }
  return (
    <div class={`bp-result bp-result-${props.status}`}>
      <div class="bp-result-glow" aria-hidden="true" />
      <div class="bp-result-head">
        <span class="bp-result-disc" aria-hidden="true">
          <Icon
            name={props.status === 'ok' ? 'check' : 'x'}
            size={props.status === 'ok' ? 34 : 30}
            strokeWidth={2.4}
          />
        </span>
        <h1>{props.title}</h1>
        {props.sub !== undefined && <p>{props.sub}</p>}
      </div>
      {props.children}
      {props.link !== undefined && <div class="bp-result-link">{props.link}</div>}
      {props.actions !== undefined && <div class="bp-bottom">{props.actions}</div>}
    </div>
  );
}

export interface ToastProps {
  message: string;
  /** Distance from the frame bottom in px: 20 by default, 76 above a bottom action. */
  bottom?: number | undefined;
}

/** A short confirmation pill ("Address copied"), announced politely. */
export function Toast({ message, bottom = 20 }: ToastProps) {
  return (
    <div class="bp-toast" role="status" style={{ bottom: `${String(bottom)}px` }}>
      <Icon name="check" size={16} strokeWidth={2.4} />
      {message}
    </div>
  );
}

/**
 * The action stack at the bottom of a flow screen: primary over secondary. Pass it as the
 * `footer` of `Layout`, which pins it under the scrolling body.
 */
export function BottomActions(props: { children: ComponentChildren }) {
  return <div class="bp-bottom">{props.children}</div>;
}
