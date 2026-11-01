import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../../i18n';
import type { ListedToken, TokenBalances } from '../../protocol';
import { TokenErrorCodes } from '../../protocol';
import { useClient } from '../../popup/client-context';
import { Button, Sheet, TextField } from '../../ui';
import { loadBalancesFor } from './data';
import { amountText } from './format';

export interface SwitcherProps {
  open: boolean;
  tokens: ListedToken[];
  selected: string;
  onSelect: (denom: string) => void;
  /** The preferred list changed (add or remove). */
  onTokens: (tokens: ListedToken[]) => void;
  onClose: () => void;
}

/** `W-Switcher` and `W-Switcher-Search`: preferred tokens with balances, search, add, remove. */
export function Switcher(props: SwitcherProps) {
  const client = useClient();
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<ListedToken[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState(false);
  const [balances, setBalances] = useState<Map<string, TokenBalances | null>>(new Map());
  const seq = useRef(0);

  useEffect(() => {
    if (!props.open) return;
    let live = true;
    void loadBalancesFor(client, props.tokens).then((m) => {
      if (live) setBalances(m);
    });
    return () => {
      live = false;
    };
  }, [props.open, props.tokens, client]);

  const search = async (value: string) => {
    setQuery(value);
    setMissing(false);
    setError(false);
    const id = ++seq.current;
    const q = value.trim();
    if (q === '') {
      setFound(null);
      return;
    }
    const res = await client.call('tokens.search', { query: q });
    if (id !== seq.current) return;
    if (!res.ok) {
      setError(true);
      return;
    }
    if (res.value.length > 0) {
      setFound(res.value);
      return;
    }
    // Nothing known matches: a pasted code may still be a token on chain.
    const looked = await client.call('tokens.lookup', { code: q });
    if (id !== seq.current) return;
    if (looked.ok) setFound([looked.value]);
    else {
      setFound([]);
      if (looked.error.code === TokenErrorCodes.noSuchToken) setMissing(true);
      else setError(true);
    }
  };

  const change = async (method: 'tokens.add' | 'tokens.remove', denom: string) => {
    const res = await client.call(method, { denom });
    if (res.ok) props.onTokens(res.value);
    else setError(true);
  };

  const preferred = new Set(props.tokens.map((x) => x.denom));
  const rows = found ?? props.tokens;
  const last = props.tokens.length <= 1;

  return (
    <Sheet open={props.open} title={t('home.switcher.title')} onClose={props.onClose}>
      <TextField
        label={t('home.switcher.search')}
        value={query}
        onInput={(v) => {
          void search(v);
        }}
      />
      {error && <p role="alert">{t('home.switcher.failed')}</p>}
      {missing && <p>{t('home.switcher.none')}</p>}
      <ul class="bp-home-tokens">
        {rows.map((tok) => {
          const picked = preferred.has(tok.denom);
          const bal = balances.get(tok.denom);
          return (
            <li key={tok.denom} class="bp-home-row" aria-current={tok.denom === props.selected}>
              {picked ? (
                <button
                  type="button"
                  class="bp-home-label"
                  onClick={() => {
                    props.onSelect(tok.denom);
                    props.onClose();
                  }}
                >
                  {tok.symbol}
                </button>
              ) : (
                <span class="bp-home-label">{tok.symbol}</span>
              )}
              <span class="bp-home-amount">
                {picked && bal ? amountText(bal.total, tok.decimals) : ''}
              </span>
              {picked ? (
                <button
                  type="button"
                  class="bp-home-icon"
                  disabled={last}
                  title={last ? t('home.switcher.removeLast') : undefined}
                  aria-label={t('home.switcher.remove', { symbol: tok.symbol })}
                  onClick={() => {
                    void change('tokens.remove', tok.denom);
                  }}
                >
                  ×
                </button>
              ) : (
                <Button
                  variant="quiet"
                  label={t('home.switcher.add', { symbol: tok.symbol })}
                  onClick={() => {
                    void change('tokens.add', tok.denom);
                  }}
                >
                  +
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
