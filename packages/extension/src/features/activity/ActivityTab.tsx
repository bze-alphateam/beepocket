import { shortAddress } from '@beepocket/core';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../../i18n';
import type { ActivityItem, ListedToken, TokenBalances, WalletAddress } from '../../protocol';
import { useClient } from '../../popup/client-context';
import { Button, EmptyState, FeedRow, FilterChip, Spinner, Tag } from '../../ui';
import { useAddressFilter, type AddressFilter } from './filter';
import { amountParts, whenText } from './format';
import { lookFor } from './words';

export interface ActivityTabProps {
  /** The wallet's tokens: a row's token Scan has no symbol for still reads as the wallet knows it. */
  tokens: ListedToken[];
  addresses: WalletAddress[];
  /** A change of the total means a transaction landed: the feed starts over. */
  balances: TokenBalances | null;
  /** Which address the list shows; the chip in the tabs row sets it. */
  filter: AddressFilter;
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

/** One transaction (`W-Activity`): disc, words over address and counterparty, amounts over time. */
function ActivityCard({ item, explorer, known }: CardProps) {
  const look = lookFor({ ...item, success: true });
  const title = item.feeOnly ? t('activity.fee') : look.words;
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
    <FeedRow
      class="bp-act-card"
      href={txUrl(explorer, item.txHash)}
      label={`${label}. ${t('activity.opens')}`}
      icon={look.icon}
      tone={failed ? 'bad' : look.dir === null ? 'inset' : 'soft'}
      failed={failed}
      title={<span class="bp-act-what">{title}</span>}
      tag={failed ? <Tag tone="bad">{t('activity.tag.failed')}</Tag> : undefined}
      sub={
        <span class="bp-act-address">
          <span class="bp-act-addr-label">{item.addressLabel}</span>
          {item.feeOnly && item.kind !== 'fee_only' && (
            <span class="bp-act-arrow">· {look.words}</span>
          )}
          {item.counterparty !== null && (
            <>
              {look.dir !== null && (
                <span class="bp-act-arrow" aria-hidden="true">
                  {look.dir}
                </span>
              )}
              <span class="bp-act-cp" data-mono={mono ? '' : null}>
                {item.counterparty}
              </span>
            </>
          )}
        </span>
      }
      value={
        parts.length > 0 ? (
          <>
            {parts.map((p, n) => (
              <span class="bp-act-asset" key={`${p.denom}-${String(n)}`}>
                <span class="bp-act-amount" data-negative={p.value.startsWith('−') ? '' : null}>
                  {p.value}
                </span>
                <span
                  class="bp-act-symbol"
                  data-unknown={p.unknown ? '' : null}
                  title={p.unknown ? p.denom : undefined}
                >
                  {p.symbol}
                </span>
              </span>
            ))}
          </>
        ) : undefined
      }
      caption={when}
    />
  );
}

/** Right of the Home tabs (`W-Activity-Filter`): which address the Activity list shows. */
export function ActivityFilterChip(props: { addresses: WalletAddress[]; filter: AddressFilter }) {
  const { addresses, filter } = props;
  const value = useAddressFilter(filter, addresses);
  if (addresses.length < 2) return null;
  const all = t('activity.address.all');
  const current = addresses.find((a) => a.index === value)?.label ?? all;
  return (
    <FilterChip
      title={t('activity.filter.title')}
      label={t('activity.filter', { value: current })}
      all=""
      value={value === null ? '' : String(value)}
      options={[
        {
          value: '',
          label: all,
          sub: t('activity.filter.count', { count: String(addresses.length) }),
        },
        ...addresses.map((a) => ({
          value: String(a.index),
          label: a.label,
          sub: shortAddress(a.address),
        })),
      ]}
      onChange={(v) => {
        filter.set(v === '' ? null : Number(v));
      }}
    />
  );
}

/** The wallet's whole activity, whatever token it involved, newest first, 10 rows at a time. */
export function ActivityTab(props: ActivityTabProps) {
  const client = useClient();
  const { tokens, addresses } = props;
  const filter = useAddressFilter(props.filter, addresses);
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
  const idle = !feed.busy && !feed.error;

  return (
    <div class="bp-act">
      {!first && (
        <ul class="bp-act-list" aria-label={t('activity.list')}>
          {feed.items.map((item, i) => (
            <li key={`${String(item.addressIndex)}-${item.txHash ?? 'block'}-${String(i)}`}>
              <ActivityCard item={item} explorer={feed.explorer} known={tokens} />
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
        <div class="bp-act-error" role="alert">
          <EmptyState icon="alert-circle" tone="inset" title={t('activity.error')} />
          <Button
            variant="ghost"
            onClick={() => {
              void read(!first);
            }}
          >
            {t('activity.retry')}
          </Button>
        </div>
      )}
      {idle && first && feed.done && (
        <EmptyState
          icon="activity"
          tone="inset"
          title={t('activity.empty')}
          sub={t('activity.empty.sub')}
        />
      )}
      {idle && !feed.done && feed.cursor !== null && (
        <>
          <Button
            variant="secondary"
            class="bp-act-more"
            onClick={() => {
              void read(true);
            }}
          >
            {t('activity.more')}
          </Button>
          <p class="bp-act-foot">{t('activity.showing', { count: String(feed.items.length) })}</p>
        </>
      )}
      {idle && feed.done && (
        <div class="bp-act-end">
          {!first && <p class="bp-act-foot">{t('activity.end')}</p>}
          <Button variant="ghost" tone="link" trailingIcon="external-link" href={feed.explorer}>
            {t('activity.older')}
          </Button>
        </div>
      )}
    </div>
  );
}
