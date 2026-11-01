import { shortAddress } from '@beepocket/core';
import { t } from '../../i18n';
import type { BookMatch } from '../../protocol';
import type { SendQuote } from '../../protocol/send';
import { Banner, Button, Spinner } from '../../ui';
import { PasswordGate } from '../lock/PasswordGate';
import { exact, feeText, totalText } from './format';

export function matchLabel(match: BookMatch | null): string | null {
  if (match?.kind === 'contact') return match.name;
  if (match?.kind === 'own') return match.label;
  return null;
}

/** `W-Review`, `W-Review-Fee`, `W-Review-Locked`: exactly what `send.submit` will sign. */
export function ReviewScreen(props: {
  quote: SendQuote;
  fromLabel: string;
  toLabel: string | null;
  /** The weak lock: the button becomes the password gate. */
  locked: boolean;
  busy: boolean;
  /** The fee moved since the last look. */
  changed: boolean;
  error: string | null;
  onFee: () => void;
  onConfirm: () => void;
  onUnlocked: () => void;
  onEdit: () => void;
}) {
  const { quote } = props;
  return (
    <main class="bp-send">
      <div class="bp-send-hero">
        <small>{t('send.review.youSend')}</small>
        <strong>
          {exact(quote.amount, quote.token.decimals)} <span>{quote.token.symbol}</span>
        </strong>
      </div>
      <dl class="bp-send-card">
        <div>
          <dt>{t('send.from')}</dt>
          <dd>
            <strong>{props.fromLabel}</strong>
            <span class="bp-send-mono">{shortAddress(quote.from.address)}</span>
          </dd>
        </div>
        <div>
          <dt>{t('send.to')}</dt>
          <dd>
            {props.toLabel !== null && <strong>{props.toLabel}</strong>}
            <span class="bp-send-mono">{quote.to}</span>
          </dd>
        </div>
        <div>
          <dt>{t('send.review.fee')}</dt>
          <dd>
            <button
              type="button"
              class="bp-send-link"
              aria-label={t('send.review.fee.change', { fee: feeText(quote.fee) })}
              onClick={props.onFee}
            >
              ≈ {feeText(quote.fee)} ▾
            </button>
          </dd>
        </div>
        <div>
          <dt>{t('send.review.total')}</dt>
          <dd>
            <strong>{totalText(quote)}</strong>
          </dd>
        </div>
      </dl>
      <p class="bp-send-note">{t('send.review.warning')}</p>
      {props.changed && <Banner tone="amber">{t('send.review.changed')}</Banner>}
      {props.error !== null && <Banner tone="red">{props.error}</Banner>}
      <div class="bp-send-actions">
        {props.locked ? (
          <PasswordGate label={t('send.review.unlock')} onUnlocked={props.onUnlocked} />
        ) : (
          <Button disabled={props.busy} onClick={props.onConfirm}>
            {t('send.review.confirm')}
          </Button>
        )}
        <Button variant="quiet" onClick={props.onEdit}>
          {t('send.review.edit')}
        </Button>
      </div>
    </main>
  );
}

/** `W-Pending`. */
export function PendingScreen({ amount, symbol }: { amount: string; symbol: string }) {
  return (
    <main class="bp-send bp-send-center" aria-live="polite">
      <Spinner />
      <h1>{t('send.pending.title', { amount, symbol })}</h1>
      <p class="bp-send-note">{t('send.pending.body')}</p>
    </main>
  );
}

export type Outcome =
  | { kind: 'success'; txHash: string; explorerUrl: string }
  /** `lost`: the broadcast got no answer, so it may never have reached the network. */
  | { kind: 'unconfirmed'; txHash: string; explorerUrl: string | null; lost: boolean }
  | { kind: 'failed'; message: string | null };

/** `W-Success`, `W-Failed` and the "still pending" case. */
export function ResultScreen(props: {
  outcome: Outcome;
  quote: SendQuote;
  fromLabel: string;
  toText: string;
  onDone: () => void;
  onRetry: () => void;
}) {
  const { outcome, quote } = props;
  const amount = exact(quote.amount, quote.token.decimals);
  const symbol = quote.token.symbol;
  const title =
    outcome.kind === 'success'
      ? t('send.success.title')
      : outcome.kind === 'unconfirmed'
        ? t('send.unconfirmed.title')
        : t('send.failed.title');
  const body =
    outcome.kind === 'success'
      ? t('send.success.body', { amount, symbol, to: props.toText })
      : outcome.kind === 'unconfirmed'
        ? t(outcome.lost ? 'send.unconfirmed.lost' : 'send.unconfirmed.body')
        : t('send.failed.body', { amount, symbol });
  return (
    <main class={`bp-send bp-send-result bp-send-${outcome.kind}`}>
      <h1>{title}</h1>
      <p class="bp-send-note">{body}</p>
      {outcome.kind === 'failed' && outcome.message !== null && (
        <Banner tone="red">
          <strong>{t('send.failed.node')}</strong>
          <span class="bp-send-mono">{outcome.message}</span>
        </Banner>
      )}
      <dl class="bp-send-card">
        <div>
          <dt>{t('send.result.from')}</dt>
          <dd>{props.fromLabel}</dd>
        </div>
        {outcome.kind !== 'failed' && (
          <>
            <div>
              <dt>{t('send.result.fee')}</dt>
              <dd>{feeText(quote.fee)}</dd>
            </div>
            <div>
              <dt>{t('send.result.hash')}</dt>
              <dd class="bp-send-mono">
                {outcome.txHash.slice(0, 6)}…{outcome.txHash.slice(-6)}
                <button
                  type="button"
                  class="bp-send-link"
                  aria-label={t('send.result.copy')}
                  onClick={() => {
                    navigator.clipboard.writeText(outcome.txHash).catch(() => undefined);
                  }}
                >
                  ⧉
                </button>
              </dd>
            </div>
          </>
        )}
      </dl>
      {outcome.kind !== 'failed' && outcome.explorerUrl !== null && (
        <a class="bp-send-link" href={outcome.explorerUrl} target="_blank" rel="noopener">
          {t('send.result.explorer')}
        </a>
      )}
      <div class="bp-send-actions">
        {outcome.kind === 'failed' ? (
          <>
            <Button onClick={props.onRetry}>{t('send.retry')}</Button>
            <Button variant="quiet" onClick={props.onDone}>
              {t('send.back.wallet')}
            </Button>
          </>
        ) : (
          <Button onClick={props.onDone}>{t('send.done')}</Button>
        )}
      </div>
    </main>
  );
}
