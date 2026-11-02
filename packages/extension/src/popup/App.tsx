import { initialRoute, routeTable, type AppRoute } from '../features';
import { StateSupervisor } from '../features/lock';
import { Router } from './router';

export interface AppProps {
  initial?: AppRoute;
}

export function App({ initial = initialRoute }: AppProps) {
  // The request window follows the lock state itself; the popup's supervisor would send it home.
  const supervised = initial.name !== 'dapp.request';
  return (
    <Router<AppRoute> table={routeTable} initial={initial}>
      {supervised && <StateSupervisor />}
    </Router>
  );
}
