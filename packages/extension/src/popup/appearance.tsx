import { createContext, type ComponentChildren } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';
import { AppearanceState, type Scheme, type SchemeQuery } from '../theme';
import { AppearanceButton } from '../ui';

// Outside a provider (tests, previews): the default dark appearance, not saved anywhere.
const NO_OS: SchemeQuery = { matches: true, addEventListener: () => undefined };
const AppearanceContext = createContext<AppearanceState>(new AppearanceState(NO_OS));

/** Hands the popup's one appearance state to screens; built at the composition root. */
export function AppearanceProvider(props: { state: AppearanceState; children: ComponentChildren }) {
  return (
    <AppearanceContext.Provider value={props.state}>{props.children}</AppearanceContext.Provider>
  );
}

export function useAppearance(): AppearanceState {
  return useContext(AppearanceContext);
}

/** The scheme shown now; re-renders when it changes. */
export function useScheme(): Scheme {
  const state = useAppearance();
  const [scheme, setScheme] = useState(state.current());
  useEffect(() => {
    setScheme(state.current());
    return state.subscribe(() => {
      setScheme(state.current());
    });
  }, [state]);
  return scheme;
}

/** The header's sun/moon button, wired to the appearance setting. */
export function AppearanceToggle(props: { size?: number }) {
  const state = useAppearance();
  const scheme = useScheme();
  return (
    <AppearanceButton
      scheme={scheme}
      size={props.size}
      onToggle={() => {
        state.toggle();
      }}
    />
  );
}
