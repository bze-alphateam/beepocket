import {
  formatAmount,
  isBzeAddress,
  parseAmount,
  shortAddress,
  type DenomBranding,
  type TokenInfo,
} from '@beepocket/core';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../../i18n';
import type { BookMatch, TokenBalances, WalletAddress } from '../../protocol';
import { SendErrorCodes, type SendQuote } from '../../protocol/send';
import { WalletErrorCodes } from '../../protocol/wallet';
import { useClient } from '../../popup/client-context';
import { Layout } from '../../popup/Layout';
import { useRoute, type RouteBase } from '../../popup/router';
import { applyTheme } from '../../theme';
import {
  Avatar,
  Banner,
  BottomActions,
  Button,
  Field,
  FieldAction,
  FieldSuffix,
  Icon,
  ScreenHeader,
  SelectRow,
  Spinner,
} from '../../ui';
import { AddressBookSheet } from '../address-book';
import { useSendEnv } from './env';
import { errorText, exact, feeText, plainAmount } from './format';
import { PendingScreen, ResultScreen, ReviewScreen, matchLabel, type Outcome } from './Screens';
import { FeeSheet, FromSheet, type FromRow } from './Sheets';

export interface SendRoute {
  name: 'send';
  /** The token to send. */
  denom: string;
  /** Pre-selected sender, e.g. from a row of the addresses tab. */
  fromIndex?: number;
}

const HOME: RouteBase = { name: 'home.main' };

/** The fee is estimated this long after the last change to From, To, Amount or the fee token. */
const ESTIMATE_DEBOUNCE_MS = 400;

/** The form's id: Review is pinned in the footer, outside it, and still submits it (Enter too). */
const FORM_ID = 'bp-send-form';

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

/** Amount-related refusals show under the amount; the rest as a banner on the form. */
const AMOUNT_ERRORS: readonly string[] = [
  SendErrorCodes.invalidAmount,
  SendErrorCodes.insufficientFunds,
  SendErrorCodes.amountLeavesNoFee,
];

/** Send form → review → pending → success / failed, in one route. */
export function SendFlow({ route }: { route: SendRoute }) {
  const client = useClient();
  const { navigate } = useRoute<RouteBase>();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  useTokenTheme(route.denom);

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

  if (!loaded) {
    return (
      <Layout
        header={
          <ScreenHeader
            title={t('send.loading')}
            onBack={() => {
              navigate(HOME);
            }}
          />
        }
      >
        <div class="bp-send bp-send-center">
          {loadFailed ? (
            <>
              <Banner tone="red">{t('send.failed.load')}</Banner>
              <Button onClick={() => void load()}>{t('send.retry')}</Button>
            </>
          ) : (
            <Spinner />
          )}
        </div>
      </Layout>
    );
  }
  return <Flow route={route} loaded={loaded} />;
}

/** The token's kit while the flow is open, re-applied when the scheme changes. */
function useTokenTheme(denom: string) {
  const client = useClient();
  const env = useSendEnv();
  const [kit, setKit] = useState<{ branding: DenomBranding | null; brandThemes: boolean } | null>(
    null,
  );
  useEffect(() => {
    const run = { live: true };
    void (async () => {
      const ctx = await client.call('home.context', {});
      const brandThemes = ctx.ok ? ctx.value.brandThemes : true;
      const theme = brandThemes ? await client.call('tokens.theme', { denom }) : null;
      if (run.live) setKit({ branding: theme?.ok === true ? theme.value : null, brandThemes });
    })();
    return () => {
      run.live = false;
    };
  }, [client, denom]);
  useEffect(() => {
    if (!kit) return;
    const apply = () => {
      applyTheme(env.themeTarget, { denom, ...kit, scheme: env.scheme.current() });
    };
    apply();
    return env.scheme.subscribe(apply);
  }, [env, denom, kit]);
}

function Flow({ route, loaded }: { route: SendRoute; loaded: Loaded }) {
  const client = useClient();
  const env = useSendEnv();
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
  /** The fee token the user picked on the form; null lets the default rule choose. */
  const [feeDenom, setFeeDenom] = useState<string | null>(null);
  const [match, setMatch] = useState<BookMatch | null>(null);
  /** The form's fee estimate: display only, never signed. */
  const [estimate, setEstimate] = useState<SendQuote | null>(null);
  const [estimateError, setEstimateError] = useState<{ code: string; message: string } | null>(
    null,
  );
  /** The quote on Review: exactly what Confirm signs. */
  const [quote, setQuote] = useState<SendQuote | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const [locked, setLocked] = useState(loaded.weakLocked);
  const [sheet, setSheet] = useState<'none' | 'from' | 'fee' | 'book' | 'save'>('none');
  const latestMatch = useRef(0);
  const latestEstimate = useRef(0);
  const busyRef = useRef(false);

  const target = to.trim();
  const refreshMatch = useCallback(() => {
    const id = ++latestMatch.current;
    if (target === '') {
      setMatch(null);
      return;
    }
    void client.call('book.match', { input: target }).then((r) => {
      if (id === latestMatch.current) setMatch(r.ok ? r.value : null);
    });
  }, [client, target]);
  useEffect(refreshMatch, [refreshMatch]);

  const labelOf = (index: number): string =>
    addresses.find((a) => a.index === index)?.label ?? shortAddress(String(index));
  const fromRow = rows.find((r) => r.address.index === fromIndex);
  const available = fromRow?.balance ?? 0n;

  // What the form can check without the network. The fee is only simulated once all pass.
  const typed = amount.trim();
  const parsed = max ? available : parseAmount(typed, token.decimals);
  const amountProblem: string | null =
    max || typed === ''
      ? null
      : parsed instanceof Error || parsed === 0n
        ? t('send.error.amount', { symbol: token.symbol })
        : parsed > available
          ? t('send.error.funds')
          : null;
  const ready =
    fromRow !== undefined &&
    available > 0n &&
    isBzeAddress(target) &&
    (max || (typed !== '' && amountProblem === null));
  const draftKey = ready
    ? JSON.stringify([fromIndex, target, max ? '' : typed, max, feeDenom])
    : null;

  const request = () => ({
    fromIndex,
    to: target,
    denom: token.denom,
    amount: typed,
    ...(max ? { max: true } : {}),
    ...(feeDenom === null ? {} : { feeDenom }),
  });

  // The form's fee row: debounced, only on the form, and only the newest answer is kept.
  const onForm = step.kind === 'form';
  useEffect(() => {
    const id = ++latestEstimate.current;
    setEstimate(null);
    setEstimateError(null);
    if (!onForm || draftKey === null) return;
    const req = request();
    return env.scheduler.after(ESTIMATE_DEBOUNCE_MS, () => {
      void client.call('send.prepare', req).then((res) => {
        if (id !== latestEstimate.current) return;
        if (!res.ok) {
          setEstimateError(res.error);
          return;
        }
        setEstimate(res.value);
        // Max paid in the same token: show what will really be sent.
        if (max) setAmount(plainAmount(BigInt(res.value.amount), token.decimals));
      });
    });
    // `request()` reads exactly the values `draftKey` is built from, so it is not a dependency.
  }, [client, env, onForm, draftKey]);

  /** A fresh quote for Review, with the fee token chosen on the form. */
  const toReview = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const res = await client.call('send.prepare', request());
    busyRef.current = false;
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setQuote(res.value);
    setChanged(false);
    setStep({ kind: 'review' });
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
        const again = await client.call('send.prepare', {
          ...request(),
          feeDenom: quote.fee.denom,
        });
        if (again.ok) {
          setQuote(again.value);
          setChanged(true);
        } else setError(again.error);
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
      finish({ kind: 'failed', message: status.value.message, txHash, explorerUrl });
    }
  };

  const home = () => {
    navigate(HOME);
  };
  const edit = () => {
    setError(null);
    setStep({ kind: 'form' });
  };

  if (step.kind === 'pending' && quote) {
    return (
      <Layout>
        <PendingScreen amount={exact(quote.amount, token.decimals)} symbol={token.symbol} />
      </Layout>
    );
  }
  if (step.kind === 'result' && quote) {
    return (
      <Layout>
        <ResultScreen
          outcome={step.outcome}
          quote={quote}
          fromLabel={labelOf(quote.from.index)}
          toText={matchLabel(match) ?? shortAddress(quote.to)}
          onDone={home}
          onRetry={() => {
            setStep({ kind: 'form' });
            void toReview();
          }}
          onCopy={(text) => {
            env.clipboard.writeText(text).catch(() => undefined);
          }}
        />
      </Layout>
    );
  }
  if (step.kind === 'review' && quote) {
    return (
      <Layout
        header={<ScreenHeader title={t('send.review.title')} onBack={edit} />}
        footer={
          <BottomActions>
            {/* Keyed apart from the form's Review: the DOM button is never reused as a submit
                one, which would submit the form from the very tap on Edit. */}
            <Button key="edit" variant="secondary" onClick={edit}>
              {t('send.review.edit')}
            </Button>
          </BottomActions>
        }
      >
        <ReviewScreen
          quote={quote}
          fromLabel={labelOf(quote.from.index)}
          toLabel={matchLabel(match)}
          locked={locked}
          busy={busy}
          changed={changed}
          error={error === null ? null : errorText(error, quote.token.symbol)}
          onConfirm={() => void submit()}
          onUnlocked={() => {
            setLocked(false);
            void submit();
          }}
        />
      </Layout>
    );
  }

  const noHolder = rows.every((r) => r.balance === 0n);
  const amountError =
    amountProblem ??
    (error !== null && AMOUNT_ERRORS.includes(error.code)
      ? errorText(error, token.symbol)
      : undefined);
  const formError =
    error !== null && !AMOUNT_ERRORS.includes(error.code) ? errorText(error, token.symbol) : null;
  const shownFee = estimate?.fee ?? null;
  const feeShort = shownFee === null ? '' : feeText(shownFee);
  const feeValue =
    shownFee !== null
      ? `≈ ${feeShort}`
      : draftKey !== null && estimateError === null
        ? t('send.fee.estimating')
        : t('send.fee.none');
  const fromAmount = `${exact(available.toString(), token.decimals)} ${token.symbol}`;
  return (
    <Layout
      header={
        <ScreenHeader
          title={t('send.title', { symbol: token.symbol })}
          onBack={home}
          right={<Avatar label={token.symbol} src={token.logo} size={26} />}
        />
      }
      footer={
        <BottomActions>
          <Button
            key="review"
            type="submit"
            form={FORM_ID}
            disabled={busy || target === '' || (!max && typed === '')}
          >
            {t('send.review')}
          </Button>
        </BottomActions>
      }
    >
      <form
        id={FORM_ID}
        class="bp-send"
        onSubmit={(e) => {
          e.preventDefault();
          void toReview();
        }}
        noValidate
      >
        <div class="bp-send-field">
          <span class="bp-send-label" aria-hidden="true">
            {t('send.from')}
          </span>
          <SelectRow
            label={t('send.from.change', { label: labelOf(fromIndex), amount: fromAmount })}
            title={labelOf(fromIndex)}
            subtitle={shortAddress(fromRow?.address.address ?? '')}
            value={fromAmount}
            onClick={() => {
              setSheet('from');
            }}
          />
        </div>
        <div class="bp-send-field">
          <Field
            label={t('send.to')}
            placeholder={t('send.to.placeholder')}
            mono
            value={to}
            onInput={(v) => {
              setTo(v);
              setError(null);
            }}
            trailing={
              <FieldAction
                icon="book"
                label={t('send.to.book')}
                onClick={() => {
                  setSheet('book');
                }}
              />
            }
          />
          <p class="bp-send-match" role="status">
            {(match?.kind === 'contact' || match?.kind === 'own') && (
              <>
                <Icon name="check" size={14} />
                <strong>{matchLabel(match)}</strong>
                <span>· {t(match.kind === 'contact' ? 'send.to.contact' : 'send.to.own')}</span>
              </>
            )}
            {match?.kind === 'unknown' && isBzeAddress(target) && (
              <span class="bp-send-unknown">
                {t('send.to.unknown')} ·
                <Button
                  variant="ghost"
                  onClick={() => {
                    setSheet('save');
                  }}
                >
                  {t('send.to.save')}
                </Button>
              </span>
            )}
          </p>
        </div>
        <Field
          label={t('send.amount')}
          size="amount"
          inputMode="decimal"
          value={amount}
          onInput={(v) => {
            setAmount(v);
            setMax(false);
            setError(null);
          }}
          error={amountError}
          hint={t('send.available', {
            amount: formatAmount(available, token.decimals, { maxFraction: token.decimals }),
            symbol: token.symbol,
          })}
          trailing={
            <>
              <FieldSuffix>{token.symbol}</FieldSuffix>
              <Button
                variant="chip"
                label={t('send.amount.max.label')}
                pressed={max}
                onClick={() => {
                  setAmount(plainAmount(available, token.decimals));
                  setMax(true);
                  setError(null);
                }}
              >
                {t('send.amount.max')}
              </Button>
            </>
          }
        />
        <SelectRow
          tone="quiet"
          label={shownFee === null ? t('send.fee.row.empty') : t('send.fee.row', { fee: feeShort })}
          caption={t('send.review.fee')}
          valueIcon={shownFee && <Avatar label={shownFee.symbol} src={shownFee.logo} size={18} />}
          value={feeValue}
          disabled={estimate === null}
          onClick={() => {
            setSheet('fee');
          }}
        />
        {estimateError !== null && (
          <Banner tone="red">{errorText(estimateError, token.symbol)}</Banner>
        )}
        {noHolder && <Banner tone="amber">{t('send.from.none', { symbol: token.symbol })}</Banner>}
        {formError !== null && <Banner tone="red">{formError}</Banner>}
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
      {estimate && (
        <FeeSheet
          open={sheet === 'fee'}
          label={labelOf(estimate.from.index)}
          options={estimate.options}
          selected={estimate.fee.denom}
          onPick={(d) => {
            setFeeDenom(d);
            setSheet('none');
          }}
          onClose={() => {
            setSheet('none');
          }}
        />
      )}
      <AddressBookSheet
        open={sheet === 'book' || sheet === 'save'}
        mode="pick"
        selected={target}
        newAddress={sheet === 'save' ? target : undefined}
        onPick={(address) => {
          setTo(address);
          setError(null);
          setSheet('none');
          // A just-saved contact keeps the same address: match it again.
          latestMatch.current++;
          void client.call('book.match', { input: address }).then((r) => {
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
