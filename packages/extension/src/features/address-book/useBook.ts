import { useCallback, useEffect, useState } from 'preact/hooks';
import type { Contact, OwnAddress } from '../../protocol';
import { useClient } from '../../popup/client-context';

export interface BookView {
  contacts: Contact[];
  own: OwnAddress[];
}

/** Loads `book.list` once and on demand; `failed` when the worker could not answer. */
export function useBook(): { book: BookView | null; failed: boolean; reload: () => void } {
  const client = useClient();
  const [book, setBook] = useState<BookView | null>(null);
  const [failed, setFailed] = useState(false);
  const reload = useCallback(() => {
    void client.call('book.list', {}).then((r) => {
      if (r.ok) setBook(r.value);
      setFailed(!r.ok);
    });
  }, [client]);
  useEffect(reload, [reload]);
  return { book, failed, reload };
}
