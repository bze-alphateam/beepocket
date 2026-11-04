import { formatAmount, shortAddress } from '@beepocket/core';
import { t } from '../../i18n';
import type { BookMatch } from '../../protocol';
import type { SendQuote } from '../../protocol/send';
import { Banner, Button, Card, DetailRow, Icon, ResultLayout } from '../../ui';
import { PasswordGate } from '../lock/PasswordGate';
import type { QuoteAdvanced } from './Advanced';
import { exact, feeText, totalText } from './format';

export function matchLabel(match: BookMatch | null): string | null {
  if (match?.kind === 'contact') return match.name;
  if (match?.kind === 'own') return match.label;
  return null;
}

/**
 * `W-Review`, `W-Review-Fee`, `W-Review-Locked`: exactly what `send.submit` will sign. The fee
 * is read-only here: it is chosen on the form, and Edit goes back there.
 */
export function ReviewScreen(props: {
  quote: SendQuote;
  /** The quote's Advanced settings: shown as rows, since they are signed too. */
  advanced: QuoteAdvanced | null;
  /** The settings were dropped: this send now needs more gas than that limit. */
  reset: boolean;
  fromLabel: string;
  toLabel: string | null;
  /** The weak lock: the password field signs, in place of the plain button. */
  locked: boolean;
  busy: boolean;
  /** The fee moved since the last look. */
  changed: boolean;
  error: string | null;
  onConfirm: () => void;
  onUnlocked: () => void;
}) {
  const { quote } = props;
  return (
    <div class="bp-send bp-send-review">
      <div class="bp-send-hero">
        <span class="bp-send-hero-label">{t('send.review.youSend')}</span>
        <span class="bp-send-hero-amount">
          <span>{exact(quote.amount, quote.token.decimals)}</span>
          <span class="bp-send-hero-sym">{quote.token.symbol}</span>
        </span>
      </div>
      <Card rows>
        <DetailRow label={t('send.from')}>
          <span class="bp-send-party">
            <strong>{props.fromLabel}</strong>
            <span class="bp-mono">{shortAddress(quote.from.address)}</span>
          </span>
        </DetailRow>
        <DetailRow label={t('send.to')}>
          <span class="bp-send-party bp-send-party-to">
            {props.toLabel !== null && <strong>{props.toLabel}</strong>}
            <span class="bp-mono">{quote.to}</span>
          </span>
        </DetailRow>
        <DetailRow label={t('send.review.fee')}>{feeText(quote.fee)}</DetailRow>
        {props.advanced?.customGas === true && (
          <DetailRow label={t('send.gas.row')}>
            {t('send.gas.row.value', { gas: formatAmount(BigInt(props.advanced.gasLimit), 0) })}
          </DetailRow>
        )}
        {props.advanced !== null && props.advanced.gasPrice !== 1 && (
          <DetailRow label={t('send.gas.row.price')}>
            {t('send.gas.row.price.value', {
              price: props.advanced.price,
              times: props.advanced.gasPrice,
            })}
          </DetailRow>
        )}
        <DetailRow label={t('send.review.total')} strong>
          {totalText(quote)}
        </DetailRow>
      </Card>
      <p class="bp-send-info">
        <Icon name="alert-circle" size={16} />
        <span>{t('send.review.warning')}</span>
      </p>
      {props.advanced?.warn === true && (
        <Banner tone="amber">
          {t('send.gas.warn.long', {
            gas: formatAmount(BigInt(props.advanced.gasLimit), 0),
            estimate: formatAmount(BigInt(props.advanced.estimate), 0),
          })}
        </Banner>
      )}
      {props.reset && <Banner tone="amber">{t('send.fee.reset')}</Banner>}
      {props.changed && <Banner tone="amber">{t('send.review.changed')}</Banner>}
      {props.error !== null && <Banner tone="red">{props.error}</Banner>}
      <div class="bp-send-grow" />
      {props.locked ? (
        <PasswordGate
          label={t('send.review.unlock')}
          labelIcon="lock"
          placeholder={t('send.review.password')}
          submitLabel={t('send.review.confirm')}
          onUnlocked={props.onUnlocked}
        />
      ) : (
        <Button disabled={props.busy} onClick={props.onConfirm}>
          {t('send.review.confirm')}
        </Button>
      )}
    </div>
  );
}

/** `W-Pending`. */
export function PendingScreen({ amount, symbol }: { amount: string; symbol: string }) {
  return (
    <div aria-live="polite" class="bp-send-fill">
      <ResultLayout
        status="pending"
        title={t('send.pending.title', { amount, symbol })}
        sub={t('send.pending.body')}
        pendingLabel={t('send.pending.label')}
      />
    </div>
  );
}

export type Outcome =
  | { kind: 'success'; txHash: string; explorerUrl: string }
  /** `lost`: the broadcast got no answer, so it may never have reached the network. */
  | { kind: 'unconfirmed'; txHash: string; explorerUrl: string | null; lost: boolean }
  /** `txHash` when the chain included it and it failed there (the fee was taken). */
  | { kind: 'failed'; message: string | null; txHash?: string; explorerUrl?: string };

/** `W-Success`, `W-Success-PAGE`, `W-Failed`, `W-Failed-GUILD` and the "still pending" case. */
export function ResultScreen(props: {
  outcome: Outcome;
  quote: SendQuote;
  fromLabel: string;
  toText: string;
  onDone: () => void;
  onRetry: () => void;
  onCopy: (text: string) => void;
}) {
  const { outcome, quote } = props;
  const amount = exact(quote.amount, quote.token.decimals);
  const symbol = quote.token.symbol;
  const failed = outcome.kind === 'failed';
  const title =
    outcome.kind === 'success'
      ? t('send.success.title')
      : outcome.kind === 'unconfirmed'
        ? t('send.unconfirmed.title')
        : t('send.failed.title');
  const sub =
    outcome.kind === 'success'
      ? t('send.success.body', { amount, symbol, to: props.toText })
      : outcome.kind === 'unconfirmed'
        ? t(outcome.lost ? 'send.unconfirmed.lost' : 'send.unconfirmed.body')
        : t(outcome.txHash === undefined ? 'send.failed.body' : 'send.failed.charged', {
            amount,
            symbol,
          });
  const txHash = outcome.txHash;
  const explorerUrl = outcome.explorerUrl ?? null;
  return (
    <ResultLayout
      status={outcome.kind === 'success' ? 'ok' : failed ? 'bad' : 'pending'}
      pendingLabel={t('send.pending.label')}
      title={title}
      sub={sub}
      link={
        explorerUrl === null ? undefined : (
          <Button
            variant="ghost"
            tone="link"
            icon="search"
            trailingIcon="external-link"
            href={explorerUrl}
          >
            {t('send.result.explorer')}
          </Button>
        )
      }
      actions={
        failed ? (
          <>
            <Button onClick={props.onRetry}>{t('send.retry')}</Button>
            <Button variant="secondary" onClick={props.onDone}>
              {t('send.back.wallet')}
            </Button>
          </>
        ) : (
          <Button onClick={props.onDone}>{t('send.done')}</Button>
        )
      }
    >
      {failed && outcome.message !== null && (
        <div class="bp-send-error" role="alert">
          <strong>{t('send.failed.node')}</strong>
          <span class="bp-mono">{outcome.message}</span>
        </div>
      )}
      {txHash !== undefined && (
        <Card rows>
          <DetailRow label={t('send.result.from')}>
            <strong>{props.fromLabel}</strong>
          </DetailRow>
          <DetailRow label={t('send.result.fee')}>{feeText(quote.fee)}</DetailRow>
          <DetailRow label={t('send.result.hash')}>
            <span class="bp-send-hash">
              <span class="bp-mono">
                {txHash.slice(0, 6)}…{txHash.slice(-6)}
              </span>
              <Button
                variant="icon"
                icon="copy"
                iconSize={16}
                label={t('send.result.copy')}
                onClick={() => {
                  props.onCopy(txHash);
                }}
              />
            </span>
          </DetailRow>
        </Card>
      )}
    </ResultLayout>
  );
}
