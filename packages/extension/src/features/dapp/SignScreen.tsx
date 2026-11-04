import { NETWORKS, type MsgIcon, type MsgSummary } from '@beepocket/core';
import { useState } from 'preact/hooks';
import { t } from '../../i18n';
import { Layout } from '../../popup/Layout';
import { useClient } from '../../popup/client-context';
import { WalletErrorCodes, type FeeChoice, type SignView } from '../../protocol';
import { SendErrorCodes } from '../../protocol/send';
import {
  Avatar,
  Banner,
  BottomActions,
  Button,
  Check,
  CopyButton,
  DappHeader,
  Icon,
  RiskBox,
  SelectRow,
  Sheet,
  type IconName,
} from '../../ui';
import { useHomeEnv } from '../home/env';
import { PasswordGate } from '../lock/PasswordGate';
import { feeText } from '../send/format';
import { feeKey, FeeSheet } from '../send/Sheets';
import { requestBadge, type Answer } from './answers';
import { siteName } from './ConnectedSitesScreen';
import { useFirstToken } from './theme';

export interface SignScreenProps {
  view: SignView;
  /** The request was answered (or may be): ask the worker what is next. */
  done: (answer?: Answer) => void;
  /** Requests waiting in all, this one included; 2 or more shows "1 of N". */
  queue?: number | undefined;
}

const ICONS: Record<MsgIcon, IconName> = {
  send: 'send',
  swap: 'swap',
  order: 'order',
  cancel: 'x',
  liquidity: 'liquidity',
  burn: 'burn',
  raffle: 'ticket',
  vote: 'check',
  grant: 'grant',
  unknown: 'question',
};

/** A type BeePocket has no summary for at all (not a known type that failed a check). */
const unreadable = (m: MsgSummary): boolean => m.level === 'unknown' && m.icon === 'unknown';

/** The raw view shows this many characters until "Show all": a huge payload stays cheap. */
const RAW_CAP = 20_000;

/**
 * The byte count of a message BeePocket has no decoder for, read from its raw JSON
 * (`{ typeUrl, unknown: true, value: <base64> }`), or `null` for a decoded message.
 */
function undecodedBytes(json: string | undefined): number | null {
  if (json === undefined) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { unknown, value } = parsed as { unknown?: unknown; value?: unknown };
  if (unknown !== true || typeof value !== 'string') return null;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((value.length * 3) / 4) - padding);
}

const notDecoded = (bytes: number): string =>
  t('dapp.sign.notDecoded', { bytes: bytes.toLocaleString('en-US') });

/** The one hero of a single-message request: icon, what it is, the amount, one note. */
function Hero({ message: m, json }: { message: MsgSummary; json: string | undefined }) {
  const bytes = undecodedBytes(json);
  const tone = m.level === 'dangerous' ? 'bad' : m.level === 'unknown' ? 'warn' : null;
  return (
    <div class="bp-sign-hero">
      <span class={tone === null ? 'bp-sign-tile' : `bp-sign-tile bp-sign-tile-${tone}`}>
        <Icon name={ICONS[m.icon]} size={22} strokeWidth={2} />
      </span>
      {unreadable(m) ? (
        <>
          <h2 class="bp-sign-big">{m.title}</h2>
          {bytes !== null && <p class="bp-sign-sub">{notDecoded(bytes)}</p>}
          <p class="bp-sign-note bp-sign-note-warn" role="note">
            {t('dapp.sign.unknown')}
          </p>
        </>
      ) : (
        <>
          <span class="bp-sign-kind">{m.title}</span>
          <h2 class="bp-sign-big">{m.hero}</h2>
          {m.sub !== '' && <p class="bp-sign-sub">{m.sub}</p>}
          {m.level === 'unknown' && (
            <p class="bp-sign-note bp-sign-note-warn" role="note">
              {t('dapp.sign.unchecked')}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** One message of several: its icon and one line; a tap opens its details. */
function MessageRow(props: { message: MsgSummary; json: string | undefined; onOpen: () => void }) {
  const { message: m } = props;
  const bytes = undecodedBytes(props.json);
  const line = unreadable(m)
    ? bytes === null
      ? t('dapp.sign.unknownShort')
      : `${t('dapp.sign.unknownShort')} · ${notDecoded(bytes)}`
    : m.level === 'unknown'
      ? t('dapp.sign.unchecked')
      : m.line;
  return (
    <li>
      <button
        type="button"
        class={`bp-sign-row bp-sign-row-${m.level}`}
        aria-haspopup="dialog"
        aria-label={t('dapp.sign.detailsOf', { title: m.title })}
        onClick={props.onOpen}
      >
        <span class="bp-sign-row-icon" aria-hidden="true">
          <Icon name={ICONS[m.icon]} size={15} strokeWidth={2.2} />
        </span>
        <span class="bp-sign-row-text">
          <strong>{m.title}</strong>
          <span>{line}</span>
        </span>
        <Icon name="chevron-right" size={14} strokeWidth={2.2} />
      </button>
    </li>
  );
}

/**
 * Details: the type, the plain-word rows, the memo and the raw message, for one message or (no
 * `message`) for the whole request.
 */
function Details(props: { view: SignView; index: number | null }) {
  const { view, index } = props;
  const { summary } = view;
  const env = useHomeEnv();
  const [copied, setCopied] = useState(false);
  const [all, setAll] = useState(false);
  const one = index ?? (summary.messages.length === 1 ? 0 : null);
  const message = one === null ? undefined : summary.messages[one];
  const rows = message?.rows ?? [];
  const raw = one === null ? view.rawJson : (view.messageJson[one] ?? '');
  const bytes = one === null ? null : undecodedBytes(view.messageJson[one]);
  const cut = !all && raw.length > RAW_CAP;
  return (
    <div class="bp-sign-details">
      <dl class="bp-sign-kv">
        {message && (
          <div>
            <dt>{t('dapp.sign.type')}</dt>
            <dd class="bp-mono">{message.typeUrl}</dd>
            <CopyButton
              label={t('dapp.sign.copyType')}
              copied={copied}
              onCopy={() => {
                void env.clipboard.writeText(message.typeUrl).then(() => {
                  setCopied(true);
                });
              }}
            />
          </div>
        )}
        {rows.map(([label, value, kind], i) => (
          <div key={i}>
            <dt>{label}</dt>
            <dd class={kind === 'mono' ? 'bp-mono' : undefined}>{value}</dd>
          </div>
        ))}
        {bytes !== null && (
          <div>
            <dt>{t('dapp.sign.raw')}</dt>
            <dd>{notDecoded(bytes)}</dd>
          </div>
        )}
        {index === null && summary.memo !== null && (
          <div>
            <dt>{t('dapp.sign.memo')}</dt>
            <dd>{summary.memo}</dd>
          </div>
        )}
      </dl>
      <pre class="bp-dapp-json" tabIndex={0} aria-label={t('dapp.sign.raw')}>
        {cut ? `${raw.slice(0, RAW_CAP)}…` : raw}
      </pre>
      {cut && (
        <Button
          variant="secondary"
          onClick={() => {
            setAll(true);
          }}
        >
          {t('dapp.sign.showAll', { size: `${String(Math.ceil(raw.length / 1024))} KB` })}
        </Button>
      )}
    </div>
  );
}

/** The warning under the fee row: about the site's fee, when that is the one picked. */
function feeNote(view: SignView, fee: FeeChoice): { tone: 'amber' | 'info'; text: string } | null {
  const check = view.siteFee;
  if (!check) return null;
  if (check.status === 'unusable') return { tone: 'info', text: t('dapp.sign.fee.unusable') };
  if (fee.setBy === undefined) return null;
  if (check.status === 'gas') return { tone: 'amber', text: t('dapp.sign.fee.gas') };
  if (check.status === 'low') return { tone: 'amber', text: t('dapp.sign.fee.low') };
  if (check.status === 'high') {
    const text =
      check.times === null
        ? t('dapp.sign.fee.higher')
        : t('dapp.sign.fee.high', { times: String(check.times) });
    return { tone: 'amber', text };
  }
  return null;
}

/**
 * The sign screen, in as few words as it takes: the site and the signing address on one line,
 * one hero (or one row per message), the fee and Details. Details (type, rows, memo, raw message)
 * is a sheet that stops above the footer, so Reject and Approve never leave the screen. A
 * dangerous request needs the tick before Approve works; the worker checks it again.
 */
export function SignScreen({ view, done, queue }: SignScreenProps) {
  const client = useClient();
  useFirstToken();
  const [picked, setPicked] = useState(feeKey(view.fee));
  const [feeOpen, setFeeOpen] = useState(false);
  // `null`: closed; `'all'`: the whole request; a number: that message.
  const [details, setDetails] = useState<number | 'all' | null>(null);
  const [trusted, setTrusted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A fee token the signer can no longer pay with falls back to the worker's pick.
  const fee = view.options.find((o) => feeKey(o) === picked) ?? view.fee;
  const note = feeNote(view, fee);
  const { summary } = view;
  const dangerous = summary.level === 'dangerous';
  const count = summary.messages.length;
  const many = count > 1;
  const only = summary.messages[0];
  const canApprove = !dangerous || trusted;

  const answer = async (approve: boolean) => {
    if (busy || (approve && !canApprove)) return;
    setBusy(true);
    setError(null);
    const res = await client.call('dapp.answer', {
      id: view.id,
      approve,
      ...(approve ? { fee: { denom: fee.denom, amount: fee.amount, gasLimit: fee.gasLimit } } : {}),
      ...(approve && dangerous ? { trusted: true } : {}),
    });
    setBusy(false);
    if (res.ok) {
      done({ kind: 'sign', approved: approve, origin: view.origin, label: view.signer.label, fee });
    } else if (res.error.code === 'unknown-request') {
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

  const reject = (
    <Button
      variant="secondary"
      disabled={busy}
      onClick={() => {
        void answer(false);
      }}
    >
      {t('dapp.sign.reject')}
    </Button>
  );
  const variant = dangerous ? 'danger' : 'primary';
  const actions = view.locked ? (
    <div class="bp-dapp-foot">
      <PasswordGate
        label={t('dapp.sign.password')}
        labelIcon="lock"
        placeholder={t('lock.password')}
        submitLabel={t('dapp.sign.unlock')}
        hold={!canApprove}
        variant={variant}
        secondary={reject}
        onUnlocked={() => {
          void answer(true);
        }}
      />
    </div>
  ) : (
    <BottomActions row>
      {reject}
      <Button
        variant={variant}
        disabled={busy || !canApprove}
        onClick={() => {
          void answer(true);
        }}
      >
        {busy ? t('dapp.sign.approving') : t('dapp.sign.approve')}
      </Button>
    </BottomActions>
  );
  // The details sheet lives in the footer, docked on top of it: Reject and Approve stay usable.
  const footer = (
    <>
      <Sheet
        open={details !== null}
        docked
        title={t('dapp.sign.detailsTitle')}
        onClose={() => {
          setDetails(null);
        }}
      >
        {details !== null && <Details view={view} index={details === 'all' ? null : details} />}
      </Sheet>
      {actions}
    </>
  );

  const danger = summary.dangers[0];
  return (
    <Layout
      header={
        <DappHeader
          title={t('dapp.sign.title')}
          chainId={NETWORKS[view.network].chainId}
          badge={requestBadge(queue)}
        />
      }
      footer={footer}
    >
      <main class="bp-sign">
        <div class="bp-sign-site">
          <Avatar label={siteName(view.origin)} kind="site" size={24} />
          <span class="bp-sign-domain">{siteName(view.origin)}</span>
          <span class="bp-sign-who" aria-label={`${t('dapp.sign.signer')} ${view.signer.label}`}>
            {view.signer.label}
          </span>
        </div>
        {many || !only ? (
          <>
            <div class="bp-sign-hero">
              <h2 class="bp-sign-big">{t('dapp.sign.actions', { count: String(count) })}</h2>
              <p class="bp-sign-sub">
                {t(count === 2 ? 'dapp.sign.together.two' : 'dapp.sign.together.many')}
              </p>
            </div>
            <ol class="bp-sign-card" aria-label={t('dapp.sign.messages', { count: String(count) })}>
              {summary.messages.map((m, i) => (
                <MessageRow
                  key={i}
                  message={m}
                  json={view.messageJson[i]}
                  onOpen={() => {
                    setDetails(i);
                  }}
                />
              ))}
            </ol>
          </>
        ) : (
          <Hero message={only} json={view.messageJson[0]} />
        )}
        {dangerous && (
          <RiskBox
            tone="red"
            title={danger?.title ?? t('dapp.sign.dangerFallback')}
            action={
              <Check checked={trusted} onChange={setTrusted}>
                {t('dapp.sign.trust')}
              </Check>
            }
          >
            {summary.dangers.map((d, i) => (
              <p key={i}>
                {i > 0 && <strong>{d.title}. </strong>}
                {d.text}
              </p>
            ))}
          </RiskBox>
        )}
        <div class="bp-sign-card">
          <SelectRow
            tone="quiet"
            label={t('dapp.sign.fee.change', { fee: feeText(fee) })}
            caption={t('dapp.sign.fee')}
            valueIcon={<Avatar label={fee.symbol} src={fee.logo} size={18} />}
            value={`≈ ${feeText(fee)}`}
            onClick={() => {
              setFeeOpen(true);
            }}
          />
          <button
            type="button"
            class="bp-sign-row"
            aria-haspopup="dialog"
            onClick={() => {
              setDetails('all');
            }}
          >
            <span class="bp-sign-row-label">{t('dapp.sign.details')}</span>
            <Icon name="chevron-right" size={14} strokeWidth={2.2} />
          </button>
        </div>
        {note && <Banner tone={note.tone}>{note.text}</Banner>}
        {error !== null && <Banner tone="red">{error}</Banner>}
      </main>
      <FeeSheet
        open={feeOpen}
        options={view.options}
        selected={feeKey(fee)}
        onPick={(key) => {
          setPicked(key);
          setTrusted(false);
          setFeeOpen(false);
        }}
        onClose={() => {
          setFeeOpen(false);
        }}
      />
    </Layout>
  );
}
