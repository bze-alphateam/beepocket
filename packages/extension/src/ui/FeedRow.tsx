import type { ComponentChildren } from 'preact';
import { IconTile, type IconTileProps } from './Avatar';
import type { IconName } from './icons';

export interface FeedRowProps {
  /** Where the row leads, in a new tab (the Explorer page of a transaction); without it the row is no link. */
  href?: string | undefined;
  /** Accessible name of the whole row: everything it shows, in words. */
  label: string;
  icon: IconName;
  /** The icon disc: `soft` kit accent, `inset` neutral, `bad` a failed entry. */
  tone?: IconTileProps['tone'];
  title: ComponentChildren;
  /** After the title: a `Tag` (FAILED, OPEN). */
  tag?: ComponentChildren;
  /** Second line, muted ("Main → Alex"). */
  sub?: ComponentChildren;
  /** Right column, bold: one or more amounts, stacked. */
  value?: ComponentChildren;
  /** Under the value, small and faint ("14:32 · 31 Oct"). */
  caption?: string | undefined;
  /** Marks the row as failed for styling hooks (`data-failed`). */
  failed?: boolean | undefined;
  /** An extra class for a screen hook (tests, content styles); never for restyling the kit. */
  class?: string | undefined;
}

/**
 * One entry of a feed (`W-Activity`): icon disc, title with an optional tag over a sub line, and
 * a right column with the value over a caption. With an `href` the whole row is one link.
 */
export function FeedRow(props: FeedRowProps) {
  const classes = ['bp-feed-row'];
  if (props.class !== undefined) classes.push(props.class);
  const body = (
    <>
      <IconTile icon={props.icon} tone={props.tone ?? 'soft'} size={36} iconSize={18} />
      <span class="bp-feed-row-text">
        <span class="bp-feed-row-title">
          {props.title}
          {props.tag}
        </span>
        {props.sub !== undefined && <span class="bp-feed-row-sub">{props.sub}</span>}
      </span>
      {(props.value !== undefined || props.caption !== undefined) && (
        <span class="bp-feed-row-end">
          {props.value !== undefined && <span class="bp-feed-row-value">{props.value}</span>}
          {props.caption !== undefined && <span class="bp-feed-row-caption">{props.caption}</span>}
        </span>
      )}
    </>
  );
  const shared = {
    class: classes.join(' '),
    'aria-label': props.label,
    'data-failed': props.failed === true ? '' : null,
  };
  if (props.href === undefined) {
    return (
      <div role="group" {...shared}>
        {body}
      </div>
    );
  }
  return (
    <a href={props.href} target="_blank" rel="noopener noreferrer" {...shared}>
      {body}
    </a>
  );
}
