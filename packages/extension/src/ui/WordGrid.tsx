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
  /** Called with the whole text when several words are pasted into one cell. */
  onPaste?: ((text: string, index: number) => void) | undefined;
}

const defaultLabel = (n: number) => t('app.word', { n });

/** Numbered recovery-phrase cells in three columns. */
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
                onInput={(e) => {
                  onWordInput(i, e.currentTarget.value);
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
