const HEX = /^#[0-9a-fA-F]{6}$/;

/** Chain data is untrusted: only plain `#RRGGBB` is accepted as a colour. */
export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value);
}

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function toHex(values: number[]): string {
  return (
    '#' +
    values
      .map((v) =>
        Math.round(Math.max(0, Math.min(255, v)))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

/** Linear mix: `t` = 0 gives `a`, 1 gives `b`. */
export function mix(a: string, b: string, t: number): string {
  const x = channels(a);
  const y = channels(b);
  return toHex(x.map((v, i) => v + ((y[i] ?? v) - v) * t));
}

export function alpha(hex: string, a: number): string {
  return `rgba(${channels(hex).join(',')},${String(a)})`;
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two `#RRGGBB` colours, 1 to 21. */
export function contrast(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
