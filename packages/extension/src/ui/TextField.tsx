import { Field } from './Field';

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

/** The pre-canvas text field: a plain `Field`. New screens use `Field` directly. */
export function TextField(props: TextFieldProps) {
  return <Field {...props} />;
}
