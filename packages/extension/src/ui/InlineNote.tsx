import type { ComponentChildren } from 'preact';
import { Icon, type IconName } from './icons';

export interface InlineNoteProps {
  /** `error` red with the alert icon (announced), `success` green with a check, `neutral` muted. */
  tone: 'error' | 'success' | 'neutral';
  /** Replaces the tone's icon (`link` on "Filled in from …"). */
  icon?: IconName | undefined;
  children: ComponentChildren;
}

const ICONS = { error: 'alert-circle', success: 'check', neutral: undefined } as const;

/**
 * One small line with an icon that belongs to the content above it but to no single field: the
 * import word check, "Filled in from …". Same look as a `Field` note.
 */
export function InlineNote({ tone, icon, children }: InlineNoteProps) {
  const name = icon ?? ICONS[tone];
  const classes = ['bp-field-note'];
  if (tone !== 'neutral') classes.push(`bp-field-${tone}`);
  return (
    <p class={classes.join(' ')} role={tone === 'error' ? 'alert' : undefined}>
      {name !== undefined && <Icon name={name} size={14} />}
      <span>{children}</span>
    </p>
  );
}
