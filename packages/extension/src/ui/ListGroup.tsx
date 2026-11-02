import type { ComponentChildren } from 'preact';
import { SectionLabel } from './SectionLabel';

export interface ListGroupProps {
  title: string;
  count?: number | string | undefined;
  /**
   * Option rows without their hairline: only the picked row shows its border
   * (the token switcher). Off by default, as in the From and fee sheets.
   */
  flat?: boolean | undefined;
  children: ComponentChildren;
}

/** A titled group of `ListRow`s: "PREFERRED · 4" over its rows, 2 px apart. */
export function ListGroup({ title, count, flat = false, children }: ListGroupProps) {
  return (
    <section class={flat ? 'bp-list-group bp-list-group-flat' : 'bp-list-group'}>
      <SectionLabel title={title} count={count} />
      {children}
    </section>
  );
}
