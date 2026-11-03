import type { ComponentChildren } from 'preact';
import { Icon } from './icons';

export interface RiskBoxProps {
  /**
   * - `red`: the boxed alert of a dangerous message, with its title, text and the trust tick.
   * - `amber`: one warning line ("First time on this site…", an unknown message).
   */
  tone: 'red' | 'amber';
  /** `red`: the bold alert line. */
  title?: string | undefined;
  children: ComponentChildren;
  /** `red`: under the text, the kit `Check` the user must tick. */
  action?: ComponentChildren;
}

/** A warning: the red risk box (`role="alert"`) or the amber note (`role="note"`). */
export function RiskBox({ tone, title, children, action }: RiskBoxProps) {
  if (tone === 'amber') {
    return (
      <p class="bp-risk bp-risk-amber" role="note">
        <Icon name="alert-triangle" size={14} />
        <span>{children}</span>
      </p>
    );
  }
  return (
    <div class="bp-risk bp-risk-red" role="alert">
      {title !== undefined && (
        <p class="bp-risk-title">
          <Icon name="alert-triangle" size={16} />
          <span>{title}</span>
        </p>
      )}
      <div class="bp-risk-text">{children}</div>
      {action}
    </div>
  );
}
