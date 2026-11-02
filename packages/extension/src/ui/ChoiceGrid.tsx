export interface ChoiceGridProps {
  /** The question above the options ("Word #3"). */
  legend: string;
  options: readonly string[];
  /** The picked option, or undefined before a pick. */
  value: string | undefined;
  onChange: (value: string) => void;
}

/** One question with its options as tiles in three columns, the pick outlined (`Ob-Confirm`). */
export function ChoiceGrid({ legend, options, value, onChange }: ChoiceGridProps) {
  return (
    <fieldset class="bp-choices">
      <legend>{legend}</legend>
      <div class="bp-choices-grid">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            class={o === value ? 'bp-choice-tile bp-choice-tile-on' : 'bp-choice-tile'}
            aria-pressed={o === value}
            onClick={() => {
              onChange(o);
            }}
          >
            {o}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
