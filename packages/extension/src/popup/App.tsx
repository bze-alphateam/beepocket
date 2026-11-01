import { initialRoute, routeTable, type AppRoute } from '../features';
import { Router } from './router';

export function App() {
  return <Router<AppRoute> table={routeTable} initial={initialRoute} />;
}
