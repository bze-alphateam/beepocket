import type { RouteTable } from '../../popup/router';
import { AddressBookPage } from './AddressBookPage';

/** Settings › Address book, a full page. */
export interface BookRoute {
  name: 'settings.book';
}

export const bookRoutes: RouteTable<BookRoute> = { 'settings.book': AddressBookPage };
