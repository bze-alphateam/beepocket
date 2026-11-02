import { t } from '../../i18n';
import { Layout } from '../../popup/Layout';
import { useRoute, type RouteBase, type RouteTable } from '../../popup/router';
import { ScreenHeader } from '../../ui';
import { AddressBookSheet } from './AddressBookSheet';

/** `back` is where closing goes (the entry point passes its own route); Settings by default. */
export interface BookRoute {
  name: 'book';
  back?: RouteBase;
}

const SETTINGS: RouteBase = { name: 'settings.main' };

/** Settings › Address book: the shared sheet in manage mode until Settings opens it itself. */
function BookScreen({ route }: { route: BookRoute }) {
  const { navigate } = useRoute<RouteBase>();
  const leave = () => {
    navigate(route.back ?? SETTINGS);
  };
  return (
    <Layout header={<ScreenHeader title={t('book.title')} onBack={leave} />}>
      <AddressBookSheet open mode="manage" onClose={leave} />
    </Layout>
  );
}

export const bookRoutes: RouteTable<BookRoute> = { book: BookScreen };
