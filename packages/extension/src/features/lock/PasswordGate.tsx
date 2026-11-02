import type { ComponentChildren } from 'preact';
import { t } from '../../i18n';
import { useClient } from '../../popup/client-context';
import type { IconName } from '../../ui';
import { PasswordForm } from './PasswordForm';

export interface PasswordGateProps {
  /** Field label; defaults to the password label. */
  label?: string;
  /** Button text; defaults to "Unlock and approve". */
  submitLabel?: string;
  /** The weak lock is lifted: continue with the action that asked for it. */
  onUnlocked: () => void;
  /** Keep the button disabled until something else is done. */
  hold?: boolean;
  variant?: 'primary' | 'danger';
  /** An icon before the label ("Enter your password to sign" on Review). */
  labelIcon?: IconName;
  /** Shown in the empty field. */
  placeholder?: string;
  /** A button set left of submit, side by side (Reject on a sign request). */
  secondary?: ComponentChildren;
}

/** "Unlock and approve" in place: asks the password, calls `wallet.reauth`, no navigation. */
export function PasswordGate(props: PasswordGateProps) {
  const { label, submitLabel, onUnlocked, hold, variant, labelIcon, placeholder, secondary } =
    props;
  const client = useClient();
  return (
    <PasswordForm
      label={label ?? t('lock.password')}
      submitLabel={submitLabel ?? t('lock.gate.approve')}
      check={(password) => client.call('wallet.reauth', { password })}
      onSuccess={onUnlocked}
      {...(hold === undefined ? {} : { hold })}
      {...(variant === undefined ? {} : { variant })}
      {...(labelIcon === undefined ? {} : { labelIcon })}
      {...(placeholder === undefined ? {} : { placeholder })}
      {...(secondary === undefined ? {} : { secondary })}
    />
  );
}
