import type { ComponentChildren } from 'preact';
import { Icon } from './icons';

export interface CardProps {
  /** `plain`: card background with a hairline (rows, details). `edge`: the Home total card. */
  variant?: 'plain' | 'edge' | undefined;
  /** Rows stacked with dividers between them (Review details) instead of padded content. */
  rows?: boolean | undefined;
  children: ComponentChildren;
}

/** A rounded surface. */
export function Card({ variant = 'plain', rows = false, children }: CardProps) {
  const classes = ['bp-card', `bp-card-${variant}`];
  if (rows) classes.push('bp-card-rows');
  return <div class={classes.join(' ')}>{children}</div>;
}

/** One "label … value" line inside a `Card rows` (From, Network fee, Total). */
export function DetailRow(props: {
  label: string;
  children: ComponentChildren;
  /** The bold Total line. */
  strong?: boolean | undefined;
}) {
  return (
    <div class={props.strong === true ? 'bp-detail bp-detail-strong' : 'bp-detail'}>
      <span class="bp-detail-label">{props.label}</span>
      <span class="bp-detail-value">{props.children}</span>
    </div>
  );
}

export interface ListRowProps {
  title: string;
  /** Second line; monospace by default (addresses). */
  subtitle?: string | undefined;
  /** Plain text subtitle instead of monospace (token names, balances). */
  plainSubtitle?: boolean | undefined;
  /** Before the text: an `Avatar` or an `IconTile`. */
  leading?: ComponentChildren;
  /** Next to the title: the rename pencil (an icon `Button` with a label). */
  titleAction?: ComponentChildren;
  /** Next to the subtitle: the copy button. */
  subtitleAction?: ComponentChildren;
  /** Right column, large: a balance or an amount. */
  value?: string | undefined;
  /** Right column, small line under the value: the symbol or a date. */
  unit?: string | undefined;
  /** Dims the value (an empty balance). */
  valueMuted?: boolean | undefined;
  /** A chevron at the far right: the row opens something. */
  chevron?: boolean | undefined;
  /** At the far right instead of a chevron: a radio dot, a check, a small action. */
  trailing?: ComponentChildren;
  /** Makes the whole row one button; inner actions stay separately clickable. */
  onClick?: (() => void) | undefined;
  /** Accessible name of the whole-row button ("Send BZE from Main"). */
  label?: string | undefined;
  /** Picked state of a choice list (soft accent border and fill). */
  selected?: boolean | undefined;
  disabled?: boolean | undefined;
  /** `card`: the 78 px Home address card. `option`: the compact 52 px sheet row. */
  size?: 'card' | 'option' | undefined;
}

/**
 * A list row: avatar or icon, title and subtitle, right value, trailing chevron. Clickable rows
 * lay one button over the whole row, so the pencil and copy buttons inside stay their own
 * controls (`W-Home-BZE`).
 */
export function ListRow(props: ListRowProps) {
  const classes = ['bp-list-row', `bp-list-row-${props.size ?? 'card'}`];
  if (props.selected === true) classes.push('bp-list-row-on');
  if (props.disabled === true) classes.push('bp-list-row-off');
  const trailing =
    props.chevron === true ? <Icon name="chevron-right" size={16} /> : props.trailing;
  return (
    <div class={classes.join(' ')}>
      {props.onClick && (
        <button
          type="button"
          class="bp-list-row-hit"
          aria-label={props.label}
          aria-pressed={props.selected}
          disabled={props.disabled}
          onClick={props.onClick}
        />
      )}
      {props.leading}
      <div class="bp-list-row-text">
        <div class="bp-list-row-line">
          <span class="bp-list-row-title">{props.title}</span>
          {props.titleAction}
        </div>
        {props.subtitle !== undefined && (
          <div class="bp-list-row-line">
            <span
              class={props.plainSubtitle === true ? 'bp-list-row-sub' : 'bp-list-row-sub bp-mono'}
            >
              {props.subtitle}
            </span>
            {props.subtitleAction}
          </div>
        )}
      </div>
      {(props.value !== undefined || trailing !== undefined) && (
        <div class="bp-list-row-end">
          {props.value !== undefined && (
            <span class="bp-list-row-value">
              <span
                class={
                  props.valueMuted === true ? 'bp-list-row-amount bp-muted' : 'bp-list-row-amount'
                }
              >
                {props.value}
              </span>
              {props.unit !== undefined && <span class="bp-list-row-unit">{props.unit}</span>}
            </span>
          )}
          {trailing}
        </div>
      )}
    </div>
  );
}
