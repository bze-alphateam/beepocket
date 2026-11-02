import { t } from '../i18n';
import { Button } from './Button';

export interface AppearanceButtonProps {
  /** The scheme shown now: dark shows the sun (to light), light shows the moon. */
  scheme: 'dark' | 'light';
  onToggle: () => void;
  /** Icon size: 20 on Home and Welcome, 18 in the onboarding step header. */
  size?: number | undefined;
}

/** The sun/moon button that flips between explicit dark and light. */
export function AppearanceButton({ scheme, onToggle, size = 20 }: AppearanceButtonProps) {
  const dark = scheme === 'dark';
  return (
    <Button
      variant="icon"
      icon={dark ? 'sun' : 'moon'}
      iconSize={size}
      label={t(dark ? 'app.appearance.toLight' : 'app.appearance.toDark')}
      onClick={onToggle}
    />
  );
}
