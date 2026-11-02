import { t } from '../../i18n';
import { useClient } from '../../popup/client-context';
import { PasswordForm } from './PasswordForm';

export interface PasswordGateProps {
  /** Field label; defaults to the password label. */
  label?: string;
  /** Button text; defaults to "Unlock and approve". */
  submitLabel?: string;
  /** The weak lock is lifted: continue with the action that asked for it. */
  onUnlocked: () => void;
}

/** "Unlock and approve" in place: asks the password, calls `wallet.reauth`, no navigation. */
export function PasswordGate({ label, submitLabel, onUnlocked }: PasswordGateProps) {
  const client = useClient();
  return (
    <PasswordForm
      label={label ?? t('lock.password')}
      submitLabel={submitLabel ?? t('lock.gate.approve')}
      check={(password) => client.call('wallet.reauth', { password })}
      onSuccess={onUnlocked}
    />
  );
}
