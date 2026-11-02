/**
 * Arrow-key selection for a single-choice group with a roving tabindex: the picked item has
 * `tabIndex` 0, the others -1. Arrows move the choice (wrapping), Home and End jump to the ends,
 * and focus follows to the newly picked item once it re-rendered.
 */
export function rovingKeyDown<V>(
  e: KeyboardEvent,
  values: readonly V[],
  current: V | null,
  select: (value: V) => void,
): void {
  if (values.length === 0) return;
  const at = current === null ? -1 : values.indexOf(current);
  let next: number;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = at + 1;
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = at < 0 ? values.length - 1 : at - 1;
  else if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = values.length - 1;
  else return;
  e.preventDefault();
  const value = values[(next + values.length) % values.length];
  if (value === undefined) return;
  select(value);
  const group = e.currentTarget;
  if (!(group instanceof HTMLElement)) return;
  setTimeout(() => {
    group.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
  }, 0);
}
