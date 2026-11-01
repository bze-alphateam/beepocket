import { initialRoute, routeTable, type AppRoute } from '../features';
import { StateSupervisor } from '../features/lock';
import { Router } from './router';

export function App() {
  return (
    <Router<AppRoute> table={routeTable} initial={initialRoute}>
      <StateSupervisor />
    </Router>
  );
}
