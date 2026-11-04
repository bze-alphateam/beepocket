import { NETWORKS, type MsgIcon, type MsgSummary } from '@beepocket/core';
import { useState } from 'preact/hooks';
import { t } from '../../i18n';
import { Layout } from '../../popup/Layout';
import { useClient } from '../../popup/client-context';
import { WalletErrorCodes, type SignView } from '../../protocol';
import { SendErrorCodes } from '../../protocol/send';
import {
  Avatar,
  Banner,
  BottomActions,
  Button,
  Check,
  DappHeader,
  DetailCard,
  GhostRow,
  MessageCard,
  RequestHero,
  RiskBox,
  SelectRow,
  Sheet,
  SiteCard,
  type DetailCardRow,
  type IconName,
} from '../../ui';
import { PasswordGate } from '../lock/PasswordGate';
import { feeText } from '../send/format';
import { FeeSheet } from '../send/Sheets';
import { requestBadge, type Answer } from './answers';
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

/** The last part of a type URL: `/bze.tradebin.MsgMultiSwap` → `MsgMultiSwap`. */
const typeTail = (typeUrl: string): string => typeUrl.split('.').pop() ?? typeUrl;

/** The raw JSON of an unknown message, inline and focusable so it can be scrolled. */
function RawJson({ json }: { json: string | undefined }) {
  return (
    <pre class="bp-dapp-json bp-dapp-raw" tabIndex={0}>
      {json ?? ''}
    </pre>
  );
}

/** One message of a multi-message request: its line, its rows and, when unknown, its raw JSON. */
function MessageItem(props: {
  message: MsgSummary;
  json: string | undefined;
  n: number;
  count: number;
}) {
  const { message: m } = props;
  const tone = m.level === 'dangerous' ? 'bad' : m.level === 'unknown' ? 'warn' : 'accent';
  return (
    <MessageCard
      class={`bp-dapp-card bp-dapp-card-${m.level}`}
      icon={ICONS[m.icon]}
      title={m.title}
      line={m.line}
      position={t('dapp.sign.cardNo', { n: String(props.n), count: String(props.count) })}
      tone={tone}
    >
      {m.rows.length > 0 && <DetailCard rows={m.rows} />}
      {m.level === 'unknown' && (
        <>
          <RiskBox tone="amber">{t('dapp.sign.unknown')}</RiskBox>
          <RawJson json={props.json} />
        </>
      )}
    </MessageCard>
  );
}

/**
 * The sign screen: the site and the signing address, the plain-word summary, the fee and, behind
 * "Message details", the decoded messages. Every message is shown and numbered; an unknown one
 * shows its raw JSON and a dangerous one needs a tick before Approve works. The worker checks
 * the tick again when the answer arrives.
 */
export function SignScreen({ view, done, queue }: SignScreenProps) {
  const client = useClient();
  useFirstToken();
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
  const footer = view.locked ? (
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

  const rows: DetailCardRow[] = many ? [] : [...summary.rows];
  if (summary.memo !== null) rows.push([t('dapp.sign.memo'), summary.memo]);

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
      <main class="bp-dapp bp-dapp-sign">
        <SiteCard
          origin={view.origin}
          aside={
            <>
              {t('dapp.sign.signer')}
              <strong>{view.signer.label}</strong>
            </>
          }
        />
        <RequestHero
          icon={many || !only ? 'order' : ICONS[only.icon]}
          kind={summary.title}
          hero={many ? t('dapp.sign.together') : summary.hero}
          sub={
            many
              ? t(count === 2 ? 'dapp.sign.together.two' : 'dapp.sign.together.many')
              : summary.sub
          }
          tone={dangerous ? 'bad' : 'accent'}
        />
        {dangerous && (
          <RiskBox
            tone="red"
            title={summary.dangers[0]?.title ?? t('dapp.sign.dangerFallback')}
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
        {!many && only?.level === 'unknown' && (
          <RiskBox tone="amber">{t('dapp.sign.unknown')}</RiskBox>
        )}
        {many && (
          <ol class="bp-dapp-cards" aria-label={t('dapp.sign.messages', { count: String(count) })}>
            {summary.messages.map((m, i) => (
              <MessageItem key={i} message={m} json={view.messageJson[i]} n={i + 1} count={count} />
            ))}
          </ol>
        )}
        <DetailCard
          rows={rows}
          footer={
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
          }
        />
        <GhostRow
          icon="code"
          title={t('dapp.sign.details')}
          hint={
            many || !only
              ? t('dapp.sign.messages', { count: String(count) })
              : typeTail(only.typeUrl)
          }
          onClick={() => {
            setDetailsOpen(true);
          }}
        />
        {!many && only?.level === 'unknown' && <RawJson json={view.messageJson[0]} />}
        {error !== null && <Banner tone="red">{error}</Banner>}
      </main>
      <FeeSheet
        open={feeOpen}
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
        <div class="bp-dapp-rawsheet">
          {!many && only && <p class="bp-dapp-rawtype bp-mono">{only.typeUrl}</p>}
          <pre class="bp-dapp-json">{view.rawJson}</pre>
          <p class="bp-dapp-rawnote">{t('dapp.sign.rawNote')}</p>
          <Button
            variant="secondary"
            onClick={() => {
              setDetailsOpen(false);
            }}
          >
            {t('dapp.sign.rawBack')}
          </Button>
        </div>
      </Sheet>
    </Layout>
  );
}
