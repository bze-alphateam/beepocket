import type { ComponentChildren } from 'preact';
import { Icon } from './icons';
import { WordGrid } from './WordGrid';

export interface PhraseRevealProps {
  /** Number of cells shown behind the veil (12 or 24). */
  count: number;
  revealed: boolean;
  onReveal: () => void;
  /** The veil's button text ("Reveal phrase"). */
  revealLabel: string;
  /** The line under it ("Make sure nobody can see your screen"). */
  privacyLabel: string;
  /** The real words (a `WordGrid`); rendered only once revealed. */
  children: ComponentChildren;
}

/**
 * A recovery phrase behind a veil. Until the user reveals it, the veil covers blurred empty
 * cells: the words themselves are not in the page at all, not even blurred.
 */
export function PhraseReveal(props: PhraseRevealProps) {
  if (props.revealed) return <>{props.children}</>;
  return (
    <div class="bp-reveal">
      <div class="bp-reveal-cells" aria-hidden="true">
        <WordGrid words={Array.from({ length: props.count }, () => '')} />
      </div>
      <button type="button" class="bp-reveal-veil" onClick={props.onReveal}>
        <Icon name="eye" size={22} />
        {props.revealLabel}
        <span class="bp-reveal-note">{props.privacyLabel}</span>
      </button>
    </div>
  );
}
