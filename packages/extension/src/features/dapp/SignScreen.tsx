import { shortAddress } from '@beepocket/core';
import { Fragment } from 'preact';
import { useState } from 'preact/hooks';
import { t } from '../../i18n';
import { Layout } from '../../popup/Layout';
import { useClient } from '../../popup/client-context';
import { WalletErrorCodes, type SignView } from '../../protocol';
import { SendErrorCodes } from '../../protocol/send';
import { Banner, Button, Sheet } from '../../ui';
import { PasswordGate } from '../lock/PasswordGate';
import { feeText } from '../send/format';
import { FeeSheet } from '../send/Sheets';

export interface SignScreenProps {
  view: SignView;
  /** The request was answered (or may be): ask the worker what is next. */
  done: () => void;
}

/**
 * The sign screen: the site, the signing address, the plain-word summary, the fee and, behind
 * "Message details", the decoded messages. Only a fully summarised, normal request can be
 * approved; the worker enforces that again when the answer arrives.
 */
export function SignScreen({ view, done }: SignScreenProps) {
  const client = useClient();
  const [picked, setPicked] = useState(view.fee.denom);
  const [feeOpen, setFeeOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A fee token the signer can no longer pay with falls back to the worker's pick.
  const fee = view.options.find((o) => o.denom === picked) ?? view.fee;
  const { summary } = view;

  const answer = async (approve: boolean) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await client.call('dapp.answer', {
      id: view.id,
      approve,
      ...(approve ? { fee: { denom: fee.denom, amount: fee.amount, gasLimit: view.gasLimit } } : {}),
    });
    setBusy(false);
    if (res.ok || res.error.code === 'unknown-request') {
      done();
    } else if (res.error.code === SendErrorCodes.reviewChanged) {
      setError(t('dapp.sign.changed'));
      done();
    } else if (res.error.code === WalletErrorCodes.needsPassword) {
      done();
    } else {
      setError(t('dapp.sign.failed'));
    }
  };

  return (
    <Layout>
      <main class="bp-dapp">
        <h1>{t('dapp.sign.title')}</h1>
        <dl class="bp-dapp-facts">
          <dt>{t('dapp.sign.site')}</dt>
          <dd class="bp-dapp-origin">{view.origin}</dd>
          <dt>{t('dapp.sign.signer')}</dt>
          <dd>
            <strong>{view.signer.label}</strong>{' '}
            <span class="bp-dapp-mono">{shortAddress(view.signer.address)}</span>
          </dd>
        </dl>
        {view.approvable ? (
          <>
            <div class="bp-dapp-hero">
              <strong>{summary.hero}</strong>
              <small>{summary.sub}</small>
            </div>
            <dl class="bp-dapp-rows">
              {summary.rows.map(([label, value, mono]) => (
                <Fragment key={label}>
                  <dt>{label}</dt>
                  <dd class={mono === 'mono' ? 'bp-dapp-mono' : undefined}>{value}</dd>
                </Fragment>
              ))}
              {summary.memo !== null && (
                <>
                  <dt>{t('dapp.sign.memo')}</dt>
                  <dd>{summary.memo}</dd>
                </>
              )}
              <dt>{t('dapp.sign.fee')}</dt>
              <dd>
                <button
                  type="button"
                  class="bp-dapp-link"
                  aria-label={t('dapp.sign.fee.change', { fee: feeText(fee) })}
                  onClick={() => {
                    setFeeOpen(true);
                  }}
                >
                  ≈ {feeText(fee)} ▾
                </button>
              </dd>
            </dl>
            <button
              type="button"
              class="bp-dapp-link"
              onClick={() => {
                setDetailsOpen(true);
              }}
            >
              {t('dapp.sign.details')}
            </button>
          </>
        ) : (
          <Banner tone="amber">
            <strong>{t('dapp.sign.unsupported')}</strong> {t('dapp.sign.unsupportedHint')}
          </Banner>
        )}
        {error !== null && <Banner tone="red">{error}</Banner>}
        {view.approvable && view.locked ? (
          <>
            <p class="bp-dapp-sub">{t('dapp.sign.unlockHint')}</p>
            <PasswordGate
              submitLabel={t('dapp.sign.unlock')}
              onUnlocked={() => {
                void answer(true);
              }}
            />
            <Button
              variant="quiet"
              disabled={busy}
              onClick={() => {
                void answer(false);
              }}
            >
              {t('dapp.sign.reject')}
            </Button>
          </>
        ) : (
          <div class="bp-dapp-actions">
            <Button
              variant="quiet"
              disabled={busy}
              onClick={() => {
                void answer(false);
              }}
            >
              {t('dapp.sign.reject')}
            </Button>
            {view.approvable && (
              <Button
                disabled={busy}
                onClick={() => {
                  void answer(true);
                }}
              >
                {busy ? t('dapp.sign.approving') : t('dapp.sign.approve')}
              </Button>
            )}
          </div>
        )}
      </main>
      <FeeSheet
        open={feeOpen}
        label={view.signer.label}
        options={view.options}
        selected={fee.denom}
        onPick={(denom) => {
          setPicked(denom);
          setFeeOpen(false);
        }}
        onClose={() => {
          setFeeOpen(false);
        }}
      />
      <Sheet
        open={detailsOpen}
        title={t('dapp.sign.detailsTitle')}
        onClose={() => {
          setDetailsOpen(false);
        }}
      >
        <pre class="bp-dapp-json">{view.rawJson}</pre>
      </Sheet>
    </Layout>
  );
}
