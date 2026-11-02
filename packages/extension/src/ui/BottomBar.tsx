import type { ComponentChildren } from 'preact';

export interface BottomBarProps {
  /** Left: a short status ("4 selected"), announced when it changes. */
  note: string;
  /** Right: the action, sized to its text (Finish). */
  children: ComponentChildren;
}

/** The pinned bottom row of a picker: a note on the left, one action on the right (`Ob-Tokens`). */
export function BottomBar({ note, children }: BottomBarProps) {
  return (
    <div class="bp-bottom-bar">
      <span class="bp-bottom-bar-note" role="status">
        {note}
      </span>
      {children}
    </div>
  );
}
