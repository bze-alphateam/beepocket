import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../../i18n';
import type { ActivityItem, ListedToken, TokenBalances, WalletAddress } from '../../protocol';
import { useClient } from '../../popup/client-context';
import { Banner, Button, Spinner } from '../../ui';
import { signedAmount, whenText } from './format';
import { wordsFor } from './words';

export interface ActivityTabProps {
  token: ListedToken;
  addresses: WalletAddress[];
  /** A change of the total means a transaction landed: the feed starts over. */
  balances: TokenBalances | null;
}

interface Feed {
  items: ActivityItem[];
  cursor: string | null;
  done: boolean;
  explorer: string;
  /** The last read failed; `items` and `cursor` are still good for a retry. */
  error: boolean;
  busy: boolean;
}

const FRESH: Feed = {
  items: [],
  cursor: null,
  done: false,
  explorer: '',
  error: false,
  busy: true,
};

/** The selected token's activity, newest first, 10 rows at a time. */
export function ActivityTab(props: ActivityTabProps) {
  const client = useClient();
  const { token, addresses } = props;
  const [filter, setFilter] = useState<number | null>(null);
  const [feed, setFeed] = useState<Feed>(FRESH);
  const latest = useRef(0);
  const cursor = useRef<string | null>(null);
  cursor.current = feed.cursor;

  const read = useCallback(
    async (more: boolean) => {
      const id = ++latest.current;
      setFeed((f) => ({ ...(more ? f : FRESH), error: false, busy: true }));
      const res = await client.call('activity.page', {
        denom: token.denom,
        ...(filter === null ? {} : { addressIndex: filter }),
        ...(more && cursor.current !== null ? { cursor: cursor.current } : {}),
      });
      if (id !== latest.current) return;
      setFeed((f) =>
        res.ok
          ? {
              items: more ? [...f.items, ...res.value.items] : res.value.items,
              cursor: res.value.cursor,
              done: res.value.done,
              explorer: res.value.explorer,
              error: false,
              busy: false,
            }
          : { ...f, error: true, busy: false },
      );
    },
    [client, token.denom, filter],
  );

  useEffect(() => {
    void read(false);
    return () => {
      latest.current++;
    };
  }, [read]);

  // After a transaction the balance moves: show it at the top.
  const total = props.balances?.total ?? null;
  const seen = useRef(total);
  useEffect(() => {
    if (seen.current !== null && total !== null && total !== seen.current) void read(false);
    seen.current = total;
  }, [total, read]);

  const labelled = addresses.length > 1 && filter === null;
  const first = feed.items.length === 0;

  return (
    <div class="bp-act">
      {addresses.length > 1 && (
        <select
          class="bp-act-filter"
          aria-label={t('activity.address')}
          value={filter === null ? '' : String(filter)}
          onChange={(e) => {
            const v = e.currentTarget.value;
            setFilter(v === '' ? null : Number(v));
          }}
        >
          <option value="">{t('activity.address.all')}</option>
          {addresses.map((a) => (
            <option key={a.index} value={String(a.index)}>
              {a.label}
            </option>
          ))}
        </select>
      )}
      {!first && (
        <ul class="bp-act-list" aria-label={t('activity.list')}>
          {feed.items.map((item, i) => (
            <li key={`${item.addressIndex}-${item.txHash ?? 'block'}-${i}`} class="bp-act-row">
              <span class="bp-act-what">
                {item.feeOnly && item.kind === 'fee_only' ? t('activity.fee') : wordsFor(item)}
              </span>
              <span class="bp-act-amount" data-negative={item.amount?.startsWith('-') ? '' : null}>
                {item.amount === null ? '' : signedAmount(item.amount, token.decimals)}
              </span>
              <span class="bp-act-meta">
                {[
                  item.feeOnly && item.kind !== 'fee_only' ? t('activity.fee') : null,
                  item.counterparty === null
                    ? null
                    : t('activity.counterparty', { name: item.counterparty }),
                  labelled ? item.addressLabel : null,
                  whenText(item.time),
                ]
                  .filter((x) => x !== null && x !== '')
                  .join(' · ')}
              </span>
            </li>
          ))}
        </ul>
      )}
      {feed.busy && (
        <div class="bp-home-center" role="status" aria-label={t('activity.loading')}>
          <Spinner />
        </div>
      )}
      {feed.error && (
        <div class="bp-act-error">
          <Banner tone="red">{t('activity.error')}</Banner>
          <Button
            onClick={() => {
              void read(!first);
            }}
          >
            {t('activity.retry')}
          </Button>
        </div>
      )}
      {!feed.busy && !feed.error && !feed.done && feed.cursor !== null && (
        <button
          type="button"
          class="bp-home-link"
          onClick={() => {
            void read(true);
          }}
        >
          {t('activity.more')}
        </button>
      )}
      {!feed.busy && !feed.error && feed.done && (
        <div class="bp-act-end">
          <p class="bp-home-note">
            {first ? t('activity.empty', { symbol: token.symbol }) : t('activity.end')}
          </p>
          <a class="bp-home-link" href={feed.explorer} target="_blank" rel="noreferrer">
            {t('activity.older')}
          </a>
        </div>
      )}
    </div>
  );
}
