import { t } from '../i18n';

export interface WordGridProps {
  /** One entry per cell; an empty string is an empty cell. */
  words: readonly string[];
  /** Editable cells are inputs (import); read-only cells show the words (phrase, reveal). */
  onWordInput?: ((index: number, value: string) => void) | undefined;
  /** Zero-based indexes of the cells shown with the red border. */
  invalid?: readonly number[] | undefined;
  /** Accessible name of a cell: "Word 3" by default. */
  cellLabel?: ((n: number) => string) | undefined;
  /**
   * Called with the whole text when several words land in one cell: pasted, dropped, or typed
   * by an autocorrect that inserts a space.
   */
  onPaste?: ((text: string, index: number) => void) | undefined;
}

const defaultLabel = (n: number) => t('app.word', { n });

/** Moves focus to the next editable cell of the same grid. */
function focusNext(input: HTMLInputElement): void {
  const cells = [...(input.closest('ol')?.querySelectorAll('input') ?? [])];
  cells[cells.indexOf(input) + 1]?.focus();
}

/** Numbered recovery-phrase cells in three columns. A space in a cell moves to the next one. */
export function WordGrid({ words, onWordInput, invalid = [], cellLabel, onPaste }: WordGridProps) {
  const label = cellLabel ?? defaultLabel;
  const editable = onWordInput !== undefined;
  return (
    <ol class={editable ? 'bp-words bp-words-edit' : 'bp-words'}>
      {words.map((word, i) => {
        const bad = invalid.includes(i);
        return (
          <li key={i} class={bad ? 'bp-word bp-word-bad' : 'bp-word'}>
            <span class="bp-word-n" aria-hidden="true">
              {i + 1}
            </span>
            {editable ? (
              <input
                aria-label={label(i + 1)}
                aria-invalid={bad}
                value={word}
                spellcheck={false}
                autoComplete="off"
                onKeyDown={(e) => {
                  if (e.key !== ' ') return;
                  e.preventDefault();
                  focusNext(e.currentTarget);
                }}
                onInput={(e) => {
                  const value = e.currentTarget.value;
                  if (onPaste && /\S\s+\S/.test(value.trim())) onPaste(value, i);
                  else onWordInput(i, value.trim());
                }}
                onPaste={(e) => {
                  const text = e.clipboardData?.getData('text') ?? '';
                  if (onPaste && /\s/.test(text.trim())) {
                    e.preventDefault();
                    onPaste(text, i);
                  }
                }}
              />
            ) : (
              <span aria-label={label(i + 1)}>{word}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
