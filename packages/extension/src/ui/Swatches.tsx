export interface SwatchesProps {
  /** A brand kit's background, primary and secondary, in the scheme shown now. */
  colors: readonly string[];
}

/** Small squares of a token's kit colours; decorative, the caption next to them names the kit. */
export function Swatches({ colors }: SwatchesProps) {
  return (
    <span class="bp-swatches" aria-hidden="true">
      {colors.map((c, i) => (
        <span key={i} style={{ background: c }} />
      ))}
    </span>
  );
}
