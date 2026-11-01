export interface TextFieldProps {
  label: string;
  value: string;
  onInput: (value: string) => void;
  type?: 'text' | 'password';
  placeholder?: string;
  disabled?: boolean;
  /** Shown under the field and announced with it. */
  error?: string;
  autoFocus?: boolean;
  /** Autofill hint; defaults to `off`. */
  autoComplete?: string;
}

let nextId = 0;

// Preact types `type` as a union of attribute sets; a plain string keeps one spread simple.
const inputType = (type: TextFieldProps['type']) => (type ?? 'text') as 'password';

export function TextField(props: TextFieldProps) {
  const id = `bp-field-${String(nextId++)}`;
  const errorId = `${id}-error`;
  return (
    <div class="bp-field">
      <label for={id}>{props.label}</label>
      <input
        id={id}
        type={inputType(props.type)}
        value={props.value}
        placeholder={props.placeholder}
        disabled={props.disabled}
        autoFocus={props.autoFocus}
        aria-invalid={props.error !== undefined}
        aria-describedby={props.error === undefined ? undefined : errorId}
        autoComplete={props.autoComplete ?? 'off'}
        spellcheck={false}
        onInput={(e) => {
          props.onInput(e.currentTarget.value);
        }}
      />
      {props.error !== undefined && (
        <p id={errorId} class="bp-field-error" role="alert">
          {props.error}
        </p>
      )}
    </div>
  );
}
