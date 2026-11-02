import { DropdownSheet, type DropdownSheetProps } from './DropdownSheet';

export interface FilterChipProps<V extends string> extends DropdownSheetProps<V> {
  /** The value that means "no filter"; any other value draws the chip in soft kit colours. */
  all: V;
}

/**
 * A `DropdownSheet` used as a list filter (`W-Activity-Filter`, `W-Activity-Addr`): outlined while
 * it shows everything, soft accent once it narrows the list.
 */
export function FilterChip<V extends string>({ all, ...props }: FilterChipProps<V>) {
  return (
    <span class="bp-filter-chip" data-on={props.value === all ? null : ''}>
      <DropdownSheet {...props} />
    </span>
  );
}
