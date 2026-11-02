import { shortAddress, type MsgSummary } from '@beepocket/core';
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

interface NoticeProps {
  message: MsgSummary;
  json: string | undefined;
}

/** What a message needs the user to know: nothing for a normal one, the raw message for an unknown one, a red box for a dangerous one. */
function Notice({ message, json }: NoticeProps) {
  if (message.level === 'unknown') {
    return (
      <>
        <Banner tone="amber">{t('dapp.sign.unknown')}</Banner>
        <pre class="bp-dapp-json bp-dapp-raw" tabIndex={0}>
          {json ?? ''}
        </pre>
      </>
    );
  }
  if (message.level === 'dangerous') {
    return (
      <Banner tone="red">
        <strong>{message.danger?.title ?? t('dapp.sign.dangerFallback')}</strong>{' '}
        {message.danger?.text ?? ''}
      </Banner>
    );
  }
  return null;
}

/**
 * The sign screen: the site, the signing address, the plain-word summary, the fee and, behind
 * "Message details", the decoded messages. Every message is shown and numbered; an unknown one
 * shows its raw JSON and a dangerous one needs a tick before Approve works. The worker checks
 * the tick again when the answer arrives.
 */
export function SignScreen({ view, done }: SignScreenProps) {
  const client = useClient();
  const [picked, setPicked] = useState(view.fee.denom);
  const [feeOpen, setFeeOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [trusted, setTrusted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A fee token the signer can no longer pay with falls back to the worker's pick.
  const fee = view.options.find((o) => o.denom === picked) ?? view.fee;
  const { summary } = view;
  const dangerous = summary.level === 'dangerous';
  const count = summary.messages.length;
  const many = count > 1;
  const canApprove = !dangerous || trusted;

  const answer = async (approve: boolean) => {
    if (busy || (approve && !canApprove)) return;
    setBusy(true);
    setError(null);
    const res = await client.call('dapp.answer', {
      id: view.id,
      approve,
      ...(approve
        ? { fee: { denom: fee.denom, amount: fee.amount, gasLimit: view.gasLimit } }
        : {}),
      ...(approve && dangerous ? { trusted: true } : {}),
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
        {many ? (
          <>
            <p class="bp-dapp-together">
              {t(count === 2 ? 'dapp.sign.together.two' : 'dapp.sign.together.many')}
            </p>
            <ol class="bp-dapp-cards">
              {summary.messages.map((m, i) => (
                <li key={i} class={`bp-dapp-card bp-dapp-card-${m.level}`}>
                  <small class="bp-dapp-cardno">
                    {t('dapp.sign.cardNo', { n: String(i + 1), count: String(count) })}
                  </small>
                  <strong>{m.title}</strong>
                  <span class="bp-dapp-cardhero">{m.hero}</span>
                  <span class="bp-dapp-cardline">{m.sub}</span>
                  {m.rows.length > 0 && (
                    <dl class="bp-dapp-rows">
                      {m.rows.map(([label, value, mono], row) => (
                        <Fragment key={row}>
                          <dt>{label}</dt>
                          <dd class={mono === 'mono' ? 'bp-dapp-mono' : undefined}>{value}</dd>
                        </Fragment>
                      ))}
                    </dl>
                  )}
                  <Notice message={m} json={view.messageJson[i]} />
                </li>
              ))}
            </ol>
          </>
        ) : (
          <>
            <div class="bp-dapp-hero">
              <strong>{summary.hero}</strong>
              <small>{summary.sub}</small>
            </div>
            {summary.messages.map((m, i) => (
              <Notice key={i} message={m} json={view.messageJson[i]} />
            ))}
            <dl class="bp-dapp-rows">
              {summary.rows.map(([label, value, mono]) => (
                <Fragment key={label}>
                  <dt>{label}</dt>
                  <dd class={mono === 'mono' ? 'bp-dapp-mono' : undefined}>{value}</dd>
                </Fragment>
              ))}
            </dl>
          </>
        )}
        <dl class="bp-dapp-rows">
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
        {dangerous && (
          <label class="bp-dapp-trust">
            <input
              type="checkbox"
              checked={trusted}
              onChange={(e) => {
                setTrusted((e.currentTarget as HTMLInputElement).checked);
              }}
            />
            <span>{t('dapp.sign.trust')}</span>
          </label>
        )}
        {error !== null && <Banner tone="red">{error}</Banner>}
        {view.locked ? (
          <>
            <p class="bp-dapp-sub">{t('dapp.sign.unlockHint')}</p>
            <PasswordGate
              submitLabel={t('dapp.sign.unlock')}
              hold={!canApprove}
              variant={dangerous ? 'danger' : 'primary'}
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
            <Button
              variant={dangerous ? 'danger' : 'primary'}
              disabled={busy || !canApprove}
              onClick={() => {
                void answer(true);
              }}
            >
              {busy ? t('dapp.sign.approving') : t('dapp.sign.approve')}
            </Button>
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
          setTrusted(false);
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
