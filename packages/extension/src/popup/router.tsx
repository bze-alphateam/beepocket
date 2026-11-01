import { createContext, type ComponentType } from 'preact';
import { useCallback, useContext, useMemo, useState } from 'preact/hooks';

/** A route is plain data with a `name`; a feature declares a union of its own. */
export interface RouteBase {
  name: string;
}

/** One component per route name; each receives its own route (and so its typed params). */
export type RouteTable<R extends RouteBase> = {
  [K in R['name']]: ComponentType<{ route: Extract<R, { name: K }> }>;
};

export interface RouterState<R extends RouteBase = RouteBase> {
  route: R;
  navigate: (route: R) => void;
}

const RouterContext = createContext<RouterState | null>(null);

export interface RouterProps<R extends RouteBase> {
  table: RouteTable<R>;
  initial: R;
}

/** Hash-free router: the current route lives in component state. */
export function Router<R extends RouteBase>({ table, initial }: RouterProps<R>) {
  const [route, setRoute] = useState<R>(initial);
  const navigate = useCallback((next: R) => {
    setRoute(next);
  }, []);
  const state = useMemo(() => ({ route, navigate }), [route, navigate]);
  const Screen = (table as unknown as Record<string, ComponentType<{ route: R }>>)[route.name];
  if (!Screen) return null;
  return (
    <RouterContext.Provider value={state as unknown as RouterState}>
      <Screen route={route} />
    </RouterContext.Provider>
  );
}

/** The current route and `navigate`; `R` is the app's route union. */
export function useRoute<R extends RouteBase>(): RouterState<R> {
  const state = useContext(RouterContext);
  if (!state) throw new Error('useRoute must be used inside a Router');
  return state as unknown as RouterState<R>;
}
