export interface StrengthMeterProps {
  /** Lit segments, 0 to 4. */
  level: number;
  /** The word on the right ("Strong"); it names the meter for screen readers too. */
  label: string;
  /** Status colour of the lit segments and the word; never the token's colours. */
  tone: 'bad' | 'warn' | 'ok';
}

/** Four segments and a word: how strong a new password is (`Ob-Password`). */
export function StrengthMeter({ level, label, tone }: StrengthMeterProps) {
  return (
    <div class={`bp-strength bp-strength-${tone}`}>
      <div class="bp-strength-bars" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} class={i < level ? 'bp-strength-on' : undefined} />
        ))}
      </div>
      <span class="bp-strength-label">{label}</span>
    </div>
  );
}
