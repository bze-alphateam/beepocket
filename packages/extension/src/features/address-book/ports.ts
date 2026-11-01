import type { Result, Contact, OwnAddress } from '../../protocol';

/** The profile as the address book sees it. */
export interface BookState {
  /** In storage order. */
  contacts: Contact[];
  own: OwnAddress[];
}

/** Where contacts live (the wallet's encrypted profile) and where the own addresses come from. */
export interface BookStore {
  read(): Promise<Result<BookState>>;
  /**
   * Runs `change` on the current state and saves the contacts it answers; a failure answers as
   * is and saves nothing. Writing needs the wallet unlocked.
   */
  mutate(change: (state: BookState) => Result<Contact[]>): Promise<Result<BookState>>;
}
