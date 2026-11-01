import type { ComponentChildren } from 'preact';

export interface ButtonProps {
  variant?: 'primary' | 'quiet' | 'danger';
  type?: 'button' | 'submit';
  disabled?: boolean;
  label?: string;
  onClick?: () => void;
  children: ComponentChildren;
}

export function Button({
  variant = 'primary',
  type = 'button',
  disabled = false,
  label,
  onClick,
  children,
}: ButtonProps) {
  return (
    <button
      type={type}
      class={`bp-btn bp-btn-${variant}`}
      disabled={disabled}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
