import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { Button } from './Button';
import { Field, type FieldProps } from './Field';

export interface PasswordFieldProps extends Omit<FieldProps, 'type' | 'trailing' | 'mono'> {
  /** Accessible name of the eye button while the password is hidden ("Show password"). */
  showPasswordLabel: string;
  /** …and while it is shown ("Hide password"). */
  hidePasswordLabel: string;
  /** Under the box: the `StrengthMeter`. */
  meter?: ComponentChildren;
}

/** A password `Field` with an eye button that shows or hides what was typed (`Ob-Password`). */
export function PasswordField({
  showPasswordLabel,
  hidePasswordLabel,
  meter,
  ...field
}: PasswordFieldProps) {
  const [shown, setShown] = useState(false);
  return (
    <div class="bp-password">
      <Field
        {...field}
        type={shown ? 'text' : 'password'}
        trailing={
          <Button
            variant="icon"
            icon={shown ? 'eye-off' : 'eye'}
            label={shown ? hidePasswordLabel : showPasswordLabel}
            pressed={shown}
            disabled={field.disabled}
            onClick={() => {
              setShown(!shown);
            }}
          />
        }
      />
      {meter}
    </div>
  );
}
