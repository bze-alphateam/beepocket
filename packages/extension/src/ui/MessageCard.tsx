import type { ComponentChildren } from 'preact';
import { Icon, type IconName } from './icons';

export interface MessageCardProps {
  icon: IconName;
  title: string;
  /** One line under the title: the message's amount and detail. */
  line: string;
  /** "1 of 2". */
  position: string;
  /** `bad`: a dangerous message, `warn`: an unknown one; the icon tile takes the colour. */
  tone?: 'accent' | 'bad' | 'warn' | undefined;
  /** Under the head: the message's rows, its risk box or its raw JSON. */
  children?: ComponentChildren;
  /** An extra class for a screen hook (tests). */
  class?: string | undefined;
}

/** One message of a multi-message request, as a list item. */
export function MessageCard(props: MessageCardProps) {
  const classes = ['bp-msg-card', `bp-msg-card-${props.tone ?? 'accent'}`];
  if (props.class !== undefined) classes.push(props.class);
  return (
    <li class={classes.join(' ')}>
      <div class="bp-msg-card-head">
        <span class="bp-msg-card-icon" aria-hidden="true">
          <Icon name={props.icon} size={16} />
        </span>
        <span class="bp-msg-card-text">
          <strong>{props.title}</strong>
          <span>{props.line}</span>
        </span>
        <span class="bp-msg-card-pos">{props.position}</span>
      </div>
      {props.children}
    </li>
  );
}
