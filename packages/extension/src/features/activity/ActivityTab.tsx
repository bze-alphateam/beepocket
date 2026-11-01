import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../../i18n';
import type { ActivityItem, ListedToken, TokenBalances, WalletAddress } from '../../protocol';
import { useClient } from '../../popup/client-context';
import { Banner, Button, Spinner } from '../../ui';
import { amountParts, whenText } from './format';
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

const ICONS = {
  out: 'M7 17L17 7M9 7h8v8',
  in: 'M17 7L7 17M15 17H7V9',
  swap: 'M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7',
  other: 'M12 8v8M8 12h8',
} as const;

type Direction = 'out' | 'in' | 'both';

/** Which way value moved for this address: from the sign of its changes. */
function directionOf(item: ActivityItem): Direction {
  const signs = new Set(item.amounts.map((a) => (a.amount.startsWith('-') ? 'out' : 'in')));
  if (signs.size === 1) return signs.has('out') ? 'out' : 'in';
  return 'both';
}

const ARROW: Record<Direction, string> = { out: '→', in: '←', both: '·' };

/** The explorer page of a transaction, next to the account page the service points at. */
function txUrl(explorer: string, hash: string | null): string {
  const base = explorer.replace(/\/accounts\/[^/]*$/, '');
  return hash === null ? explorer : `${base}/txs/${hash}`;
}

interface CardProps {
  item: ActivityItem;
  explorer: string;
  known: readonly ListedToken[];
}

/** One transaction: summary, address, then one row per asset; the whole card opens the Explorer. */
function ActivityCard({ item, explorer, known }: CardProps) {
  const title = item.feeOnly ? t('activity.fee') : wordsFor({ ...item, success: true });
  const dir = directionOf(item);
  const when = whenText(item.time);
  const failed = !item.success;
  const parts = item.amounts.map((a) => amountParts(a, known));
  const mono = item.counterparty !== null && /^bze1[0-9a-z…]+$/.test(item.counterparty);
  const label = [
    title,
    parts
      .map((p) => `${p.value} ${p.unknown ? `${t('activity.unknown')} ` : ''}${p.symbol}`)
      .join(', '),
    `${item.addressLabel}${item.counterparty === null ? '' : ` ${item.counterparty}`}`,
    when,
    failed ? t('activity.tag.failed') : '',
  ]
    .filter((x) => x !== '')
    .join(', ');
  return (
    <a
      class="bp-act-card"
      data-failed={failed ? '' : null}
      href={txUrl(explorer, item.txHash)}
      target="_blank"
      rel="noreferrer"
      aria-label={`${label}. ${t('activity.opens')}`}
    >
      <span class="bp-act-top">
        <span class="bp-act-icon" aria-hidden="true" data-failed={failed ? '' : null}>
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path
              d={
                item.amounts.length > 1 && dir === 'both'
                  ? ICONS.swap
                  : dir === 'both'
                    ? ICONS.other
                    : ICONS[dir]
              }
            />
          </svg>
        </span>
        <span class="bp-act-head">
          <span class="bp-act-summary">
            <span class="bp-act-what">
              {title}
              {failed && <span class="bp-act-tag">{t('activity.tag.failed')}</span>}
            </span>
            <span class="bp-act-when">{when}</span>
          </span>
          <span class="bp-act-address">
            <span class="bp-act-addr-label">{item.addressLabel}</span>
            {item.counterparty !== null && (
              <>
                <span class="bp-act-arrow" aria-hidden="true">
                  {ARROW[dir]}
                </span>
                <span class="bp-act-cp" data-mono={mono ? '' : null}>
                  {item.counterparty}
                </span>
              </>
            )}
          </span>
        </span>
      </span>
      {parts.length > 0 && (
        <span class="bp-act-assets">
          {parts.map((p, n) => (
            <span class="bp-act-asset" key={`${p.denom}-${String(n)}`}>
              <span
                class="bp-act-symbol"
                data-unknown={p.unknown ? '' : null}
                title={p.unknown ? p.denom : undefined}
              >
                {p.symbol}
              </span>
              <span class="bp-act-amount" data-negative={p.value.startsWith('−') ? '' : null}>
                {p.value}
              </span>
            </span>
          ))}
        </span>
      )}
    </a>
  );
}

/** The wallet's whole activity, whatever token it involved, newest first, 10 rows at a time. */
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
    [client, filter],
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
            <li
              key={`${String(item.addressIndex)}-${item.txHash ?? 'block'}-${String(i)}`}
              class="bp-act-row"
            >
              <ActivityCard item={item} explorer={feed.explorer} known={[token]} />
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
          <p class="bp-home-note">{first ? t('activity.empty') : t('activity.end')}</p>
          <a class="bp-home-link" href={feed.explorer} target="_blank" rel="noreferrer">
            {t('activity.older')}
          </a>
        </div>
      )}
    </div>
  );
}
