import type { RouteBase, RouteTable } from '../../popup/router';
import { AddressBookScreen } from './AddressBookScreen';

/** `back` is where the back button goes (the entry point passes its own route). */
export interface BookRoute {
  name: 'book';
  back?: RouteBase;
}

export const bookRoutes: RouteTable<BookRoute> = { book: AddressBookScreen };
