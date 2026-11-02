import { useEffect, useState } from 'preact/hooks';

/**
 * The Activity tab's address filter, shared by the chip in the Home tabs row and the list below:
 * the index of the one address shown, or null for all of them.
 */
export interface AddressFilter {
  get(): number | null;
  set(index: number | null): void;
  /** Calls `listener` after every change; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

export function createAddressFilter(): AddressFilter {
  let value: number | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(index) {
      if (index === value) return;
      value = index;
      for (const l of [...listeners]) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * The filter's current address, as long as the wallet still has it; a filter on an address that
 * is gone reads as all addresses.
 */
export function useAddressFilter(
  filter: AddressFilter,
  addresses: readonly { index: number }[],
): number | null {
  const [value, setValue] = useState(filter.get());
  useEffect(() => {
    setValue(filter.get());
    return filter.subscribe(() => {
      setValue(filter.get());
    });
  }, [filter]);
  return value !== null && addresses.some((a) => a.index === value) ? value : null;
}
