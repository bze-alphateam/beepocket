import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../../i18n';
import type { ListedToken, TokenBalances } from '../../protocol';
import { TokenErrorCodes } from '../../protocol';
import { useClient } from '../../popup/client-context';
import { Avatar, ListGroup, ListRow, SearchField, Sheet, StarButton } from '../../ui';
import { loadBalancesFor } from './data';
import { amountText, tokenColor } from './format';

export interface SwitcherProps {
  open: boolean;
  /** The preferred tokens, in order. */
  tokens: ListedToken[];
  selected: string;
  onSelect: (denom: string) => void;
  /** The preferred list changed (starred or un-starred). */
  onTokens: (tokens: ListedToken[]) => void;
  onClose: () => void;
}

interface Group {
  title: string;
  items: ListedToken[];
}

const matches = (needle: string) => (x: ListedToken) =>
  x.symbol.toLowerCase().includes(needle) || x.name.toLowerCase().includes(needle);

/**
 * `W-Switcher` and `W-Switcher-Search`: preferred tokens (starred) and the other tokens the wallet
 * holds; a star adds or removes a preferred token. Search filters both; a pasted code that nothing
 * known matches is looked up on chain.
 */
export function Switcher(props: SwitcherProps) {
  const client = useClient();
  const [query, setQuery] = useState('');
  const [held, setHeld] = useState<ListedToken[]>([]);
  const [found, setFound] = useState<ListedToken[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState(false);
  const [balances, setBalances] = useState<Map<string, TokenBalances | null>>(new Map());
  const seq = useRef(0);

  // Every token on any address: the "You hold" group. ubze is always in it, held or not.
  useEffect(() => {
    if (!props.open) return;
    let live = true;
    setQuery('');
    setFound(null);
    setMissing(false);
    setError(false);
    setBalances(new Map());
    void client.call('tokens.search', { query: '' }).then((res) => {
      if (!live) return;
      if (res.ok) setHeld(res.value);
      else setError(true);
    });
    return () => {
      live = false;
    };
  }, [props.open, client]);

  const shown = [...props.tokens, ...held, ...(found ?? [])];
  const missingDenoms = shown
    .map((x) => x.denom)
    .filter((d, i, all) => all.indexOf(d) === i && !balances.has(d));
  const wanted = missingDenoms.join(' ');
  useEffect(() => {
    if (!props.open || wanted === '') return;
    let live = true;
    const tokens = shown.filter((x) => missingDenoms.includes(x.denom));
    void loadBalancesFor(client, tokens).then((m) => {
      if (live) setBalances((cur) => new Map([...cur, ...m]));
    });
    return () => {
      live = false;
    };
    // `wanted` stands for the missing denoms.
  }, [props.open, wanted, client]);

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
    const local = props.tokens.filter(matches(q.toLowerCase()));
    const results = [...local, ...res.value.filter((x) => !local.some((l) => l.denom === x.denom))];
    if (results.length > 0) {
      setFound(results);
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
  const total = (x: ListedToken) => {
    const b = balances.get(x.denom);
    return b ? BigInt(b.total) : null;
  };
  const groups: Group[] =
    found !== null
      ? [{ title: t('home.switcher.results'), items: found }]
      : [
          { title: t('home.switcher.preferred'), items: props.tokens },
          {
            title: t('home.switcher.held'),
            items: held.filter((x) => !preferred.has(x.denom) && (total(x) ?? 0n) > 0n),
          },
        ];
  const last = props.tokens.length <= 1;

  const row = (tok: ListedToken) => {
    const picked = preferred.has(tok.denom);
    const sum = total(tok);
    return (
      <ListRow
        key={tok.denom}
        size="option"
        leading={<Avatar label={tok.symbol} color={tokenColor(tok)} src={tok.logo} size={30} />}
        title={tok.symbol}
        subtitle={tok.name}
        plainSubtitle
        value={sum === null ? '' : amountText(sum.toString(), tok.decimals)}
        valueMuted={sum === 0n}
        selected={tok.denom === props.selected}
        label={tok.symbol}
        onClick={
          picked
            ? () => {
                props.onSelect(tok.denom);
                props.onClose();
              }
            : undefined
        }
        trailing={
          <StarButton
            on={picked}
            disabled={picked && last}
            label={
              picked && last
                ? t('home.switcher.keepLast')
                : picked
                  ? t('home.switcher.unstar', { symbol: tok.symbol })
                  : t('home.switcher.star', { symbol: tok.symbol })
            }
            onToggle={() => {
              void change(picked ? 'tokens.remove' : 'tokens.add', tok.denom);
            }}
          />
        }
      />
    );
  };

  return (
    <Sheet
      open={props.open}
      title={t('home.switcher.title')}
      height="tall"
      onClose={props.onClose}
      actions={<p class="bp-home-switcher-hint">{t('home.switcher.hint')}</p>}
    >
      <div class="bp-home-switcher">
        <SearchField
          label={t('home.switcher.search')}
          placeholder={t('home.switcher.placeholder')}
          value={query}
          onInput={(v) => {
            void search(v);
          }}
        />
        {error && <p role="alert">{t('home.switcher.failed')}</p>}
        {missing && <p class="bp-home-note">{t('home.switcher.none')}</p>}
        {found !== null && found.length === 0 && !missing && !error && (
          <p class="bp-home-note">{t('home.switcher.noMatch', { query: query.trim() })}</p>
        )}
        {groups
          .filter((g) => g.items.length > 0)
          .map((g) => (
            <ListGroup key={g.title} title={g.title} count={g.items.length} flat>
              {g.items.map(row)}
            </ListGroup>
          ))}
      </div>
    </Sheet>
  );
}
