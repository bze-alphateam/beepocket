import type { JSX } from 'preact';

/**
 * The icon set, drawn on a 24-unit grid with `currentColor` strokes (the canvas boards' SVGs).
 * `width` is the stroke width each icon is drawn with on the boards.
 */
const ICONS = {
  'arrow-left': { width: 2, body: <path d="M19 12H5M11 18l-6-6 6-6" /> },
  'chevron-down': { width: 2.2, body: <path d="M6 9l6 6 6-6" /> },
  'chevron-right': { width: 2, body: <path d="M9 6l6 6-6 6" /> },
  copy: {
    width: 1.9,
    body: (
      <>
        <rect x="9" y="9" width="11" height="11" rx="2" />
        <path d="M5 15V6a2 2 0 0 1 2-2h8" />
      </>
    ),
  },
  pencil: { width: 2, body: <path d="M4 20h4L19 9l-4-4L4 16v4z" /> },
  plus: { width: 2.2, body: <path d="M12 5v14M5 12h14" /> },
  sun: {
    width: 1.8,
    body: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4" />
      </>
    ),
  },
  moon: { width: 1.8, body: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /> },
  sliders: {
    width: 1.8,
    body: (
      <>
        <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" />
        <circle cx="16" cy="6" r="2" />
        <circle cx="10" cy="12" r="2" />
        <circle cx="18" cy="18" r="2" />
      </>
    ),
  },
  lock: {
    width: 1.8,
    body: (
      <>
        <rect x="5" y="11" width="14" height="9" rx="2" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      </>
    ),
  },
  book: {
    width: 1.8,
    body: (
      <>
        <rect x="5" y="3" width="14" height="18" rx="2" />
        <circle cx="12" cy="10" r="2.5" />
        <path d="M8.5 16.5a3.5 3.5 0 0 1 7 0M3 8h2M3 12h2M3 16h2" />
      </>
    ),
  },
  search: {
    width: 2,
    body: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3.5-3.5" />
      </>
    ),
  },
  check: { width: 2.6, body: <path d="M5 12.5l4.5 4.5L19 7.5" /> },
  x: { width: 2.4, body: <path d="M6 6l12 12M18 6L6 18" /> },
  'alert-circle': {
    width: 2,
    body: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v5M12 16h.01" />
      </>
    ),
  },
  'alert-triangle': {
    width: 2,
    body: (
      <>
        <path d="M12 4l9 16H3z" />
        <path d="M12 10v4M12 17h.01" />
      </>
    ),
  },
  'external-link': {
    width: 2.2,
    body: <path d="M14 5h5v5M19 5l-8 8M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4" />,
  },
  link: {
    width: 1.8,
    body: (
      <path d="M9 15l6-6M10.5 6.5l1.8-1.8a4 4 0 0 1 5.7 5.7l-1.8 1.8M13.5 17.5l-1.8 1.8a4 4 0 0 1-5.7-5.7l1.8-1.8" />
    ),
  },
  eye: {
    width: 1.8,
    body: (
      <>
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
  },
  // Not on a board: the eye with a slash, same stroke style.
  'eye-off': {
    width: 1.8,
    body: (
      <path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.6 3.5M6.6 6.6C3.7 8.4 2 12 2 12s3.5 7 10 7c1.9 0 3.6-.6 5-1.5M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18" />
    ),
  },
  clipboard: {
    width: 1.8,
    body: (
      <>
        <rect x="6" y="4" width="12" height="17" rx="2" />
        <path d="M9 4h6v3H9z" />
      </>
    ),
  },
  grid: {
    width: 1.8,
    body: (
      <>
        <rect x="4" y="4" width="6" height="6" rx="1.5" />
        <rect x="14" y="4" width="6" height="6" rx="1.5" />
        <rect x="4" y="14" width="6" height="6" rx="1.5" />
        <rect x="14" y="14" width="6" height="6" rx="1.5" />
      </>
    ),
  },
  key: {
    width: 1.8,
    body: (
      <>
        <circle cx="8" cy="15" r="4" />
        <path d="M11 12l9-9M17 6l3 3" />
      </>
    ),
  },
  ticket: {
    width: 1.9,
    body: (
      <>
        <path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v8a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2z" />
        <path d="M10 6v12" stroke-dasharray="2 2" />
      </>
    ),
  },
  send: { width: 2.2, body: <path d="M7 17L17 7M8 7h9v9" /> },
  receive: { width: 2, body: <path d="M17 7L7 17M16 17H7V8" /> },
  swap: { width: 2, body: <path d="M7 7h11l-3-3M17 17H6l3 3" /> },
  order: { width: 2, body: <path d="M8 6h11M8 12h11M8 18h11M4 6h.01M4 12h.01M4 18h.01" /> },
  stake: { width: 2, body: <path d="M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3" /> },
  rewards: {
    width: 2,
    body: (
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6" />
    ),
  },
  burn: {
    width: 2,
    body: <path d="M12 3c1 3 4 5 4 9a4 4 0 0 1-8 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 0-8z" />,
  },
  liquidity: { width: 2, body: <path d="M12 8v8M8 12h8M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z" /> },
  grant: { width: 2, body: <path d="M8 15a4 4 0 1 1 3.5-6M11 12h10M17 12v3M20 12v2" /> },
  question: {
    width: 2,
    body: <path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5h.01" />,
  },
  code: { width: 2, body: <path d="M8 7l-5 5 5 5M16 7l5 5-5 5" /> },
  activity: { width: 1.8, body: <path d="M3 12h4l3 8 4-16 3 8h4" /> },
  star: {
    width: 1.8,
    body: (
      <path d="M12 3.8l2.5 5.1 5.6.8-4.05 3.95.96 5.6L12 16.6l-5 2.65.96-5.6L3.9 9.7l5.6-.8z" />
    ),
  },
  'star-filled': {
    width: 1.8,
    fill: true,
    body: (
      <path d="M12 3.8l2.5 5.1 5.6.8-4.05 3.95.96 5.6L12 16.6l-5 2.65.96-5.6L3.9 9.7l5.6-.8z" />
    ),
  },
  // Not on a board: a filled dot, the neutral mark of an activity kind the wallet doesn't know.
  dot: { width: 2, fill: true, body: <circle cx="12" cy="12" r="3" /> },
  // Not on a board: a clock face for the lock timers, same stroke style.
  clock: {
    width: 1.8,
    body: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v4l2.5 2.5" />
      </>
    ),
  },
  // Not on a board: a plain shield, same stroke style.
  shield: { width: 1.8, body: <path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z" /> },
} satisfies Record<string, { width: number; fill?: boolean; body: JSX.Element }>;

export type IconName = keyof typeof ICONS;

/** Every icon name, in the order above. */
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

export interface IconProps {
  name: IconName;
  /** Width and height in px; 20 by default. */
  size?: number;
  /** Overrides the board's stroke width for this icon. */
  strokeWidth?: number;
  /** Names the icon for screen readers; without it the icon is decorative (`aria-hidden`). */
  label?: string;
  class?: string;
}

/** An inline SVG icon in `currentColor`. */
export function Icon({ name, size = 20, strokeWidth, label, class: className }: IconProps) {
  const icon: { width: number; fill?: boolean; body: JSX.Element } = ICONS[name];
  return (
    <svg
      class={className === undefined ? 'bp-icon' : `bp-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={icon.fill === true ? 'currentColor' : 'none'}
      stroke="currentColor"
      stroke-width={strokeWidth ?? icon.width}
      stroke-linecap="round"
      stroke-linejoin="round"
      data-icon={name}
      {...(label === undefined
        ? { 'aria-hidden': 'true' as const }
        : { role: 'img' as const, 'aria-label': label })}
    >
      {icon.body}
    </svg>
  );
}
