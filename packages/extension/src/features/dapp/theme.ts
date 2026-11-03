import type { DenomBranding } from '@beepocket/core';
import { useEffect, useState } from 'preact/hooks';
import { useClient } from '../../popup/client-context';
import type { ListedToken } from '../../protocol';
import { applyTheme } from '../../theme';
import { useHomeEnv } from '../home/env';

/**
 * Themes a request window with the wallet's selected token, the first preferred one, and keeps
 * it on that kit when the appearance changes. Never a token from the request itself.
 */
export function useFirstToken(): ListedToken | null {
  const client = useClient();
  const [token, setToken] = useState<ListedToken | null>(null);
  const [kit, setKit] = useState<{ branding: DenomBranding | null; brandThemes: boolean }>({
    branding: null,
    brandThemes: true,
  });

  useEffect(() => {
    const run = { live: true };
    const stale = () => !run.live;
    void (async () => {
      const [list, ctx] = await Promise.all([
        client.call('tokens.preferred', {}),
        client.call('home.context', {}),
      ]);
      // A wallet that never opened its home screen has no picks yet: BZE is the default.
      const first = list.ok
        ? (list.value[0] ??
          (await client
            .call('tokens.lookup', { code: 'ubze' })
            .then((r) => (r.ok ? r.value : undefined))))
        : undefined;
      if (stale() || !first) return;
      const brandThemes = ctx.ok ? ctx.value.brandThemes : true;
      const theme = brandThemes ? await client.call('tokens.theme', { denom: first.denom }) : null;
      if (stale()) return;
      setKit({ branding: theme?.ok === true ? theme.value : null, brandThemes });
      setToken(first);
    })();
    return () => {
      run.live = false;
    };
  }, [client]);

  useTokenTheme(token?.denom ?? null, kit.branding, kit.brandThemes);
  return token;
}

/** Applies a token's kit now and again on every appearance change; `null` leaves the theme. */
export function useTokenTheme(
  denom: string | null,
  branding: DenomBranding | null,
  brandThemes: boolean,
): void {
  const env = useHomeEnv();
  useEffect(() => {
    if (denom === null) return undefined;
    const apply = () => {
      applyTheme(env.themeTarget, { denom, branding, brandThemes, scheme: env.scheme.current() });
    };
    apply();
    return env.scheme.subscribe(apply);
  }, [env, denom, branding, brandThemes]);
}
