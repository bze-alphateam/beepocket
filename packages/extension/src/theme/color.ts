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
