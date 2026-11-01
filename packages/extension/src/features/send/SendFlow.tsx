import { formatAmount, isBzeAddress, shortAddress, type TokenInfo } from '@beepocket/core';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../../i18n';
import type { BookMatch, TokenBalances, WalletAddress } from '../../protocol';
import { SendErrorCodes, type SendQuote } from '../../protocol/send';
import { WalletErrorCodes } from '../../protocol/wallet';
import { useClient } from '../../popup/client-context';
import { Layout } from '../../popup/Layout';
import { useRoute, type RouteBase } from '../../popup/router';
import { Banner, Button, Spinner, TextField } from '../../ui';
import { ContactPicker } from '../address-book';
import { errorText, exact, plainAmount } from './format';
import { PendingScreen, ResultScreen, ReviewScreen, matchLabel, type Outcome } from './Screens';
import { FeeSheet, FromSheet, SaveContactSheet, type FromRow } from './Sheets';

export interface SendRoute {
  name: 'send';
  /** The token to send. */
  denom: string;
  /** Pre-selected sender, e.g. from a row of the addresses tab. */
  fromIndex?: number;
}

const HOME: RouteBase = { name: 'home.main' };

interface Loaded {
  token: TokenInfo;
  balances: TokenBalances;
  addresses: WalletAddress[];
  weakLocked: boolean;
}

type Step =
  | { kind: 'form' }
  | { kind: 'review' }
  | { kind: 'pending' }
  | { kind: 'result'; outcome: Outcome };

/** Send form → review → pending → success / failed, in one route. */
export function SendFlow({ route }: { route: SendRoute }) {
  const client = useClient();
  const { navigate } = useRoute<RouteBase>();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    setLoadFailed(false);
    const [token, balances, addresses, state] = await Promise.all([
      client.call('tokens.lookup', { code: route.denom }),
      client.call('tokens.balances', { denom: route.denom, refresh: true }),
      client.call('wallet.addresses', {}),
      client.call('wallet.state', {}),
    ]);
    if (!token.ok || !balances.ok || !addresses.ok || !state.ok) {
      setLoadFailed(true);
      return;
    }
    setLoaded({
      token: token.value,
      balances: balances.value,
      addresses: addresses.value.addresses,
      weakLocked: state.value.state === 'weakLocked',
    });
  }, [client, route.denom]);
  useEffect(() => {
    void load();
  }, [load]);

  const back = (
    <Button
      variant="quiet"
      onClick={() => {
        navigate(HOME);
      }}
    >
      {t('send.back')}
    </Button>
  );
  if (loadFailed) {
    return (
      <Layout header={back}>
        <div class="bp-send bp-send-center">
          <Banner tone="red">{t('send.failed.load')}</Banner>
          <Button onClick={() => void load()}>{t('send.retry')}</Button>
        </div>
      </Layout>
    );
  }
  if (!loaded) {
    return (
      <Layout header={back}>
        <div class="bp-send bp-send-center">
          <Spinner />
        </div>
      </Layout>
    );
  }
  return <Flow route={route} loaded={loaded} />;
}

function Flow({ route, loaded }: { route: SendRoute; loaded: Loaded }) {
  const client = useClient();
  const { navigate } = useRoute<RouteBase>();
  const { token, balances, addresses } = loaded;
  const held = (index: number): bigint =>
    BigInt(balances.addresses.find((a) => a.index === index)?.amount ?? '0');
  const rows: FromRow[] = addresses.map((address) => ({ address, balance: held(address.index) }));
  let richest: FromRow | undefined;
  for (const r of rows) if (!richest || r.balance > richest.balance) richest = r;

  const [step, setStep] = useState<Step>({ kind: 'form' });
  const [fromIndex, setFromIndex] = useState(route.fromIndex ?? richest?.address.index ?? 0);
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [max, setMax] = useState(false);
  const [match, setMatch] = useState<BookMatch | null>(null);
  const [quote, setQuote] = useState<SendQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const [locked, setLocked] = useState(loaded.weakLocked);
  const [sheet, setSheet] = useState<'none' | 'from' | 'fee' | 'picker' | 'save'>('none');
  const latestMatch = useRef(0);
  const busyRef = useRef(false);

  const target = to.trim();
  useEffect(() => {
    const id = ++latestMatch.current;
    if (target === '') {
      setMatch(null);
      return;
    }
    void client.call('book.match', { input: target }).then((r) => {
      if (id === latestMatch.current) setMatch(r.ok ? r.value : null);
    });
  }, [client, target]);

  const labelOf = (index: number): string =>
    addresses.find((a) => a.index === index)?.label ?? shortAddress(String(index));
  const fromRow = rows.find((r) => r.address.index === fromIndex);
  const available = fromRow?.balance ?? 0n;

  const prepare = async (feeDenom?: string): Promise<SendQuote | null> => {
    setBusy(true);
    setError(null);
    const res = await client.call('send.prepare', {
      fromIndex,
      to: target,
      denom: token.denom,
      amount: amount.trim(),
      ...(max ? { max: true } : {}),
      ...(feeDenom === undefined ? {} : { feeDenom }),
    });
    setBusy(false);
    if (!res.ok) {
      setError(errorText(res.error, token.symbol));
      return null;
    }
    setQuote(res.value);
    return res.value;
  };

  const toReview = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    const q = await prepare();
    busyRef.current = false;
    if (q) {
      setChanged(false);
      setStep({ kind: 'review' });
    }
  };

  const pickFee = async (denom: string) => {
    setSheet('none');
    await prepare(denom);
  };

  const finish = (outcome: Outcome) => {
    setStep({ kind: 'result', outcome });
  };

  /** Signs and sends exactly the quote on screen, then waits for the chain. */
  const submit = async () => {
    if (!quote || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const sent = await client.call('send.submit', {
      fromIndex: quote.from.index,
      to: quote.to,
      denom: quote.token.denom,
      amount: quote.amount,
      feeDenom: quote.fee.denom,
      feeAmount: quote.fee.amount,
      gasLimit: quote.gasLimit,
    });
    setBusy(false);
    if (!sent.ok) {
      busyRef.current = false;
      if (sent.error.code === WalletErrorCodes.needsPassword) {
        setLocked(true);
      } else if (sent.error.code === SendErrorCodes.reviewChanged) {
        // The numbers moved: show the new ones and let the user look again.
        if (await prepare(quote.fee.denom)) setChanged(true);
      } else {
        finish({ kind: 'failed', message: errorText(sent.error, quote.token.symbol) });
      }
      return;
    }
    setStep({ kind: 'pending' });
    const txHash = sent.value.txHash;
    const lost = sent.value.unconfirmed === true;
    const status = await client.call('send.status', { txHash });
    busyRef.current = false;
    // Once a hash exists the send may still land: never report "failed" without the chain saying so.
    if (!status.ok) {
      finish({ kind: 'unconfirmed', txHash, explorerUrl: null, lost });
      return;
    }
    const explorerUrl = status.value.explorerUrl;
    if (status.value.status === 'confirmed') {
      // Home reads balances with a short freshness window: make its next read a fresh one.
      void client.call('tokens.balances', { denom: token.denom, refresh: true });
      finish({ kind: 'success', txHash, explorerUrl });
    } else if (status.value.status === 'pending') {
      finish({ kind: 'unconfirmed', txHash, explorerUrl, lost });
    } else {
      finish({ kind: 'failed', message: status.value.message });
    }
  };

  const home = () => {
    navigate(HOME);
  };
  const header = (
    <>
      <Button
        variant="quiet"
        onClick={() => {
          if (step.kind === 'review') setStep({ kind: 'form' });
          else home();
        }}
      >
        {t('send.back')}
      </Button>
      <h1>
        {step.kind === 'form' ? t('send.title', { symbol: token.symbol }) : t('send.review.title')}
      </h1>
    </>
  );

  if (step.kind === 'pending' && quote) {
    return (
      <Layout>
        <PendingScreen amount={exact(quote.amount, token.decimals)} symbol={token.symbol} />
      </Layout>
    );
  }
  if (step.kind === 'result' && quote) {
    const known = matchLabel(match);
    return (
      <Layout>
        <ResultScreen
          outcome={step.outcome}
          quote={quote}
          fromLabel={labelOf(quote.from.index)}
          toText={known ?? shortAddress(quote.to)}
          onDone={home}
          onRetry={() => {
            setStep({ kind: 'form' });
            void toReview();
          }}
        />
      </Layout>
    );
  }
  if (step.kind === 'review' && quote) {
    return (
      <Layout header={header}>
        <ReviewScreen
          quote={quote}
          fromLabel={labelOf(quote.from.index)}
          toLabel={matchLabel(match)}
          locked={locked}
          busy={busy}
          changed={changed}
          error={error}
          onFee={() => {
            setSheet('fee');
          }}
          onConfirm={() => void submit()}
          onUnlocked={() => {
            setLocked(false);
            void submit();
          }}
          onEdit={() => {
            setStep({ kind: 'form' });
          }}
        />
        <FeeSheet
          open={sheet === 'fee'}
          label={labelOf(quote.from.index)}
          options={quote.options}
          selected={quote.fee.denom}
          onPick={(d) => void pickFee(d)}
          onClose={() => {
            setSheet('none');
          }}
        />
      </Layout>
    );
  }

  const parsedTarget = isBzeAddress(target);
  const noHolder = rows.every((r) => r.balance === 0n);
  return (
    <Layout header={header}>
      <form
        class="bp-send"
        onSubmit={(e) => {
          e.preventDefault();
          void toReview();
        }}
        noValidate
      >
        <div class="bp-send-field">
          <span class="bp-send-label">{t('send.from')}</span>
          <button
            type="button"
            class="bp-send-row"
            onClick={() => {
              setSheet('from');
            }}
          >
            <span>
              <strong>{labelOf(fromIndex)}</strong>
              <small>{shortAddress(fromRow?.address.address ?? '')}</small>
            </span>
            <span>
              {exact(available.toString(), token.decimals)} {token.symbol} ▾
            </span>
          </button>
        </div>
        <div class="bp-send-field">
          <TextField
            label={t('send.to')}
            placeholder={t('send.to.placeholder')}
            value={to}
            onInput={(v) => {
              setTo(v);
              setError(null);
            }}
          />
          <Button
            variant="quiet"
            label={t('send.to.book')}
            onClick={() => {
              setSheet('picker');
            }}
          >
            📖
          </Button>
          <p class="bp-send-match" role="status">
            {match?.kind === 'contact' && `${match.name} · ${t('send.to.contact')}`}
            {match?.kind === 'own' && `${match.label} · ${t('send.to.own')}`}
            {match?.kind === 'unknown' && parsedTarget && (
              <>
                {t('send.to.unknown')} ·{' '}
                <button
                  type="button"
                  class="bp-send-link"
                  onClick={() => {
                    setSheet('save');
                  }}
                >
                  {t('send.to.save')}
                </button>
              </>
            )}
          </p>
        </div>
        <div class="bp-send-field">
          <TextField
            label={t('send.amount')}
            value={amount}
            onInput={(v) => {
              setAmount(v);
              setMax(false);
              setError(null);
            }}
          />
          <Button
            variant="quiet"
            onClick={() => {
              setAmount(plainAmount(available, token.decimals));
              setMax(true);
              setError(null);
            }}
          >
            {t('send.amount.max')}
          </Button>
          <small class="bp-send-note">
            {t('send.available', {
              amount: formatAmount(available, token.decimals, { maxFraction: token.decimals }),
              symbol: token.symbol,
            })}
          </small>
        </div>
        {noHolder && <Banner tone="amber">{t('send.from.none', { symbol: token.symbol })}</Banner>}
        {error !== null && <Banner tone="red">{error}</Banner>}
        <Button type="submit" disabled={busy || target === '' || amount.trim() === ''}>
          {t('send.review')}
        </Button>
      </form>
      <FromSheet
        open={sheet === 'from'}
        rows={rows}
        selected={fromIndex}
        decimals={token.decimals}
        symbol={token.symbol}
        onPick={(i) => {
          setFromIndex(i);
          setMax(false);
          setSheet('none');
        }}
        onClose={() => {
          setSheet('none');
        }}
      />
      <ContactPicker
        open={sheet === 'picker'}
        onClose={() => {
          setSheet('none');
        }}
        onPick={(address) => {
          setTo(address);
          setSheet('none');
        }}
      />
      <SaveContactSheet
        open={sheet === 'save'}
        address={target}
        onSaved={() => {
          setSheet('none');
          latestMatch.current++;
          void client.call('book.match', { input: target }).then((r) => {
            if (r.ok) setMatch(r.value);
          });
        }}
        onClose={() => {
          setSheet('none');
        }}
      />
    </Layout>
  );
}
