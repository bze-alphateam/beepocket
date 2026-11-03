import type { ComponentChildren } from 'preact';
import { Icon, type IconName } from './icons';

export interface SettingsRowProps {
  title: string;
  /** A muted second line under the title. */
  sub?: string | undefined;
  /** The 18 px muted icon before the title (grid, link, key, lock). */
  icon?: IconName | undefined;
  /** Right, muted: a count ("4") or a value ("15 min · 1 h"). */
  value?: string | undefined;
  /** Draws the value fainter and smaller: a note ("Password needed"), not a value. */
  note?: boolean | undefined;
  /** Makes the row a button that opens something. */
  onClick?: (() => void) | undefined;
  /** Accessible name of the row button; the visible text by default. */
  label?: string | undefined;
  /** A control on the right instead of a value (the Appearance segments): a 56 px plain row. */
  children?: ComponentChildren;
}

/** A plain row on a sheet, no box: icon, title, a value or a control on the right (`W-Settings`). */
export function SettingsRow(props: SettingsRowProps) {
  const body = (
    <>
      {props.icon !== undefined && <Icon name={props.icon} size={18} />}
      {props.sub === undefined ? (
        <span class="bp-settings-row-title">{props.title}</span>
      ) : (
        <span class="bp-settings-row-text">
          <span class="bp-settings-row-title">{props.title}</span>
          <span class="bp-settings-row-sub">{props.sub}</span>
        </span>
      )}
      {props.value !== undefined && (
        <span class={props.note === true ? 'bp-settings-row-note' : 'bp-settings-row-value'}>
          {props.value}
        </span>
      )}
      {props.children}
    </>
  );
  if (props.onClick === undefined) {
    return <div class="bp-settings-row bp-settings-row-control">{body}</div>;
  }
  return (
    <button type="button" class="bp-settings-row" aria-label={props.label} onClick={props.onClick}>
      {body}
    </button>
  );
}
