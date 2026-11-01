import { createContext, type ComponentChildren } from 'preact';
import { useContext } from 'preact/hooks';
import type { Random } from '@beepocket/core';

const RandomContext = createContext<Random | null>(null);

/** Hands the `Random` to the onboarding screens; the composition root supplies the real one. */
export function RandomProvider(props: { random: Random; children: ComponentChildren }) {
  return <RandomContext.Provider value={props.random}>{props.children}</RandomContext.Provider>;
}

export function useRandom(): Random {
  const random = useContext(RandomContext);
  if (!random) throw new Error('useRandom must be used inside a RandomProvider');
  return random;
}
