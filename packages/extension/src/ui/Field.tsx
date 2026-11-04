import type { ComponentChildren } from 'preact';
import { useMemo } from 'preact/hooks';
import { Icon } from './icons';

export interface FieldProps {
  label: string;
  /** Keeps the label for screen readers only (Unlock shows a placeholder instead). */
  hideLabel?: boolean | undefined;
  value: string;
  onInput: (value: string) => void;
  type?: 'text' | 'password' | undefined;
  /** Monospace text for addresses and token denoms. */
  mono?: boolean | undefined;
  /** `md` 44 px, `lg` 48 px (Unlock), `amount` 52 px with the large bold amount text. */
  size?: 'md' | 'lg' | 'amount' | undefined;
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
  autoFocus?: boolean | undefined;
  /** Autofill hint; defaults to `off`. */
  autoComplete?: string | undefined;
  inputMode?: 'text' | 'decimal' | 'numeric' | undefined;
  maxLength?: number | undefined;
  /** Inside the box after the input: an icon button, a suffix like "BZE", a chip like MAX. */
  trailing?: ComponentChildren;
  /** A neutral line under the field ("Available 12.5 BZE"). */
  hint?: string | undefined;
  /** An error line with the alert icon; marks the input invalid and is announced. */
  error?: string | undefined;
  /** A success line with the check icon ("Passwords match"). */
  success?: string | undefined;
}

let nextId = 0;

// Preact types `type` as a union of attribute sets; a plain string keeps one spread simple.
const inputType = (type: FieldProps['type']) => (type ?? 'text') as 'password';

/** A labelled input with an optional trailing adornment and one hint line. */
export function Field(props: FieldProps) {
  const id = useMemo(() => `bp-field-${String(nextId++)}`, []);
  const noteId = `${id}-note`;
  const note = props.error ?? props.success ?? props.hint;
  const classes = ['bp-field'];
  if (props.mono === true) classes.push('bp-field-mono');
  if (props.size !== undefined && props.size !== 'md') classes.push(`bp-field-${props.size}`);
  return (
    <div class={classes.join(' ')}>
      <label for={id} class={props.hideLabel === true ? 'bp-sr-only' : undefined}>
        {props.label}
      </label>
      <div class="bp-field-box">
        <input
          id={id}
          type={inputType(props.type)}
          value={props.value}
          placeholder={props.placeholder}
          disabled={props.disabled}
          autoFocus={props.autoFocus}
          inputMode={props.inputMode}
          maxLength={props.maxLength}
          aria-invalid={props.error !== undefined}
          aria-describedby={note === undefined ? undefined : noteId}
          autoComplete={props.autoComplete ?? 'off'}
          spellcheck={false}
          onInput={(e) => {
            props.onInput(e.currentTarget.value);
          }}
        />
        {props.trailing}
      </div>
      {props.error !== undefined ? (
        <p id={noteId} class="bp-field-note bp-field-error" role="alert">
          <Icon name="alert-circle" size={14} />
          <span>{props.error}</span>
        </p>
      ) : props.success !== undefined ? (
        <p id={noteId} class="bp-field-note bp-field-success">
          <Icon name="check" size={14} />
          <span>{props.success}</span>
        </p>
      ) : (
        props.hint !== undefined && (
          <p id={noteId} class="bp-field-note">
            {props.hint}
          </p>
        )
      )}
    </div>
  );
}

/** A plain suffix inside a field box, e.g. the token symbol after the amount. */
export function FieldSuffix(props: { children: ComponentChildren }) {
  return <span class="bp-field-suffix">{props.children}</span>;
}
