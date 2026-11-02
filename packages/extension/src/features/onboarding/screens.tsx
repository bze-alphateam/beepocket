import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  isMnemonicPrefix,
  isMnemonicWord,
  suggestMnemonicWord,
  validateMnemonic,
} from '@beepocket/core';
import { t } from '../../i18n';
import { TokenErrorCodes, WalletErrorCodes, type ListedToken } from '../../protocol';
import { useClient } from '../../popup/client-context';
import { AppearanceToggle, useScheme } from '../../popup/appearance';
import { Layout } from '../../popup/Layout';
import { BZE_DENOM, resolveKit, type Scheme } from '../../theme';
import {
  Avatar,
  Banner,
  BottomActions,
  BottomBar,
  Button,
  Check,
  ChoiceGrid,
  Field,
  IconTile,
  InlineNote,
  Logo,
  NoticeCard,
  OnboardingHeader,
  PasswordField,
  PhraseReveal,
  RadioCardGroup,
  SearchField,
  Segmented,
  Spinner,
  StrengthMeter,
  TokenRow,
  WordGrid,
} from '../../ui';
import { tokenColor } from '../home/format';
import { useOnboardingEnv } from './env';
import { useRandom } from './random';
import { makeQuiz, type QuizQuestion } from './quiz';
import { MIN_PASSWORD_LENGTH, strengthOf } from './password';

/** Where a step sits in its flow: drawn by the header as "n of N" and the progress segments. */
export interface StepFrame {
  index: number;
  total: number;
  /** ← in the header; absent once going back makes no sense (the wallet exists). */
  onBack?: (() => void) | undefined;
}

/** The frame of every step after Welcome: header, title block, body, pinned actions. */
function Step(
  props: StepFrame & {
    title: string;
    hint?: string | undefined;
    footer?: ComponentChildren;
    /** Space between the body's blocks, as on each board. */
    gap?: 12 | 14 | 16;
    children: ComponentChildren;
  },
) {
  return (
    <Layout
      glow="tall"
      header={
        <OnboardingHeader
          step={props.index}
          total={props.total}
          onBack={props.onBack}
          trailing={<AppearanceToggle size={18} />}
        />
      }
      footer={props.footer}
    >
      <section class={`ob-step ob-gap-${String(props.gap ?? 12)}`}>
        <div class="ob-title">
          <h1>{props.title}</h1>
          {props.hint !== undefined && <p>{props.hint}</p>}
        </div>
        {props.children}
      </section>
    </Layout>
  );
}

/** The add-a-token link that started the flow, as Welcome names it. */
export interface WelcomeLink {
  symbol: string | null;
  color?: string | undefined;
  host: string | null;
}

function LinkNotice({ link }: { link: WelcomeLink }) {
  const host = link.host === null ? undefined : t('onboarding.link.from', { host: link.host });
  if (link.symbol === null) {
    if (host === undefined) return null;
    return <NoticeCard leading={<IconTile icon="link" size={32} />} title={host} />;
  }
  return (
    <NoticeCard
      leading={<Avatar label={link.symbol} color={link.color} />}
      title={t('onboarding.link.title', { symbol: link.symbol })}
      sub={host}
    />
  );
}

export function Welcome(props: {
  onCreate: () => void;
  onImport: () => void;
  /** Set when an add-a-token link started the flow. */
  link?: WelcomeLink | undefined;
}) {
  return (
    <Layout glow="tall" corner={<AppearanceToggle />}>
      <section class="ob-welcome">
        <div class="ob-welcome-hero">
          <h1 class="bp-sr-only">{t('onboarding.welcome.title')}</h1>
          <span class="ob-welcome-mark">
            <Logo variant="lockup" />
          </span>
          <p class="ob-welcome-tagline">{t('onboarding.welcome.tagline')}</p>
        </div>
        {props.link !== undefined && (
          <div class="ob-welcome-link">
            <LinkNotice link={props.link} />
          </div>
        )}
        <div class="ob-welcome-actions">
          <Button size="lg" onClick={props.onCreate}>
            {t('onboarding.welcome.create')}
          </Button>
          <Button variant="secondary" size="lg" onClick={props.onImport}>
            {t('onboarding.welcome.import')}
          </Button>
          <small class="ob-welcome-note">{t('onboarding.welcome.selfCustody')}</small>
        </div>
      </section>
    </Layout>
  );
}

const PHRASE_WORDS = 24;

/** Create's phrase: always 24 words, hidden until revealed, then copied or written down. */
export function Phrase(props: {
  frame: StepFrame;
  phrase: string | null;
  failed: boolean;
  onRetry: () => void;
  onContinue: () => void;
}) {
  const env = useOnboardingEnv();
  const [revealed, setRevealed] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const phrase = props.phrase;
  const ready = phrase !== null && revealed;
  const copy = () => {
    if (phrase === null) return;
    // Clipboard failures are not worth blocking the flow on.
    void env.clipboard.writeText(phrase).then(
      () => {
        setCopied(true);
      },
      () => undefined,
    );
  };
  let body;
  if (props.failed) {
    body = (
      <>
        <Banner tone="red">{t('app.error.generic')}</Banner>
        <Button variant="secondary" onClick={props.onRetry}>
          {t('onboarding.phrase.retry')}
        </Button>
      </>
    );
  } else if (phrase === null) {
    body = (
      <p class="ob-wait" role="status">
        <Spinner /> {t('onboarding.phrase.loading')}
      </p>
    );
  } else {
    body = (
      <>
        <PhraseReveal
          count={PHRASE_WORDS}
          revealed={revealed}
          onReveal={() => {
            setRevealed(true);
          }}
          revealLabel={t('onboarding.phrase.reveal')}
          privacyLabel={t('onboarding.phrase.privacy')}
        >
          <WordGrid words={phrase.split(' ')} />
        </PhraseReveal>
        {revealed && (
          <Button variant="chip" icon={copied ? 'check' : 'copy'} class="ob-copy" onClick={copy}>
            {copied ? t('onboarding.phrase.copied') : t('onboarding.phrase.copy')}
          </Button>
        )}
      </>
    );
  }
  return (
    <Step
      {...props.frame}
      title={t('onboarding.phrase.title')}
      hint={t('onboarding.phrase.warning')}
      footer={
        <BottomActions>
          {ready && (
            <Check checked={saved} onChange={setSaved}>
              {t('onboarding.phrase.saved')}
            </Check>
          )}
          <Button disabled={!ready || !saved} onClick={props.onContinue}>
            {t('onboarding.continue')}
          </Button>
        </BottomActions>
      }
    >
      {body}
    </Step>
  );
}

export function Confirm(props: { frame: StepFrame; phrase: string; onDone: () => void }) {
  const random = useRandom();
  // Chosen once per mount; leaving and returning asks new positions.
  const quiz: QuizQuestion[] = useMemo(
    () => makeQuiz(random, props.phrase),
    [random, props.phrase],
  );
  const [picks, setPicks] = useState<Record<number, string>>({});
  const [wrong, setWrong] = useState(false);
  const submit = () => {
    if (quiz.every((q) => picks[q.position] === q.answer)) props.onDone();
    else setWrong(true);
  };
  return (
    <Step
      {...props.frame}
      gap={16}
      title={t('onboarding.confirm.title')}
      hint={t('onboarding.confirm.hint')}
      footer={
        <BottomActions>
          <Button disabled={quiz.some((q) => picks[q.position] === undefined)} onClick={submit}>
            {t('onboarding.continue')}
          </Button>
        </BottomActions>
      }
    >
      {quiz.map((q) => (
        <ChoiceGrid
          key={q.position}
          legend={t('onboarding.confirm.position', { n: q.position })}
          options={q.options}
          value={picks[q.position]}
          onChange={(w) => {
            setWrong(false);
            setPicks({ ...picks, [q.position]: w });
          }}
        />
      ))}
      {wrong && <Banner tone="red">{t('onboarding.confirm.wrong')}</Banner>}
    </Step>
  );
}

export const wordsOf = (text: string): string[] =>
  text.trim().toLowerCase().split(/\s+/).filter(Boolean);

type PhraseLength = '12' | '24';

/** Every cell the import step can show; the length control picks how many are in use. */
export const IMPORT_CELLS = 24;

/** The active length's words, the phrase Continue checks and the wallet is made from. */
export const phraseOf = (cells: readonly string[], length: 12 | 24): string =>
  cells.slice(0, length).join(' ');

/**
 * Import: one cell per word, checked against the BIP-39 list as the user types. All 24 cells live
 * in the parent (`Onboarding`), which drops them when the flow leaves the phrase behind; on 12,
 * cells 13–24 are kept out of sight so switching back to 24 restores them.
 */
export function ImportPhrase(props: {
  frame: StepFrame;
  cells: readonly string[];
  length: 12 | 24;
  /** The service refused the phrase (bad checksum after the password step). */
  error: boolean;
  onChange: (cells: string[], length: 12 | 24) => void;
  onDone: () => void;
}) {
  const env = useOnboardingEnv();
  const { cells, length } = props;
  const words = cells.slice(0, length);
  // After a Continue that found unknown words, a word must be complete, not just a prefix.
  const [strict, setStrict] = useState(false);
  const [checksum, setChecksum] = useState(false);
  // A paste that did not fit: its word count, shown instead of writing part of it.
  const [refused, setRefused] = useState<number | null>(null);
  const edit = (next: string[], nextLength: 12 | 24 = length) => {
    setChecksum(false);
    setRefused(null);
    props.onChange(next, nextLength);
  };
  /**
   * A whole 12- or 24-word phrase replaces every cell and sets the length. Fewer words fill the
   * cells from `at` on when they fit; anything else writes nothing and says why.
   */
  const place = (text: string, at: number) => {
    const parts = wordsOf(text);
    if (parts.length === 12 || parts.length === 24) {
      edit(
        Array.from({ length: IMPORT_CELLS }, (_, i) => parts[i] ?? ''),
        parts.length,
      );
      return;
    }
    if (at + parts.length > length) {
      setChecksum(false);
      setRefused(parts.length);
      return;
    }
    const next = [...cells];
    parts.forEach((w, k) => {
      next[at + k] = w;
    });
    edit(next);
  };
  const bad = words.flatMap((w, i) =>
    w !== '' && !(strict ? isMnemonicWord(w) : isMnemonicPrefix(w)) ? [i] : [],
  );
  const first = bad[0];
  const filled = words.every((w) => w !== '');
  const paste = () => {
    // Read only here, on the user's tap: never on mount or on entering the step.
    void env.clipboard.readText().then(
      (text) => {
        place(text, 0);
      },
      () => undefined,
    );
  };
  const submit = () => {
    const check = validateMnemonic(phraseOf(cells, length));
    if (check.ok) props.onDone();
    else if (check.reason === 'unknown-word') setStrict(true);
    else setChecksum(true);
  };
  let note;
  if (refused !== null) {
    note = (
      <InlineNote tone="error">{t('onboarding.import.countBad', { count: refused })}</InlineNote>
    );
  } else if (first !== undefined) {
    const word = words[first] ?? '';
    const suggestion = suggestMnemonicWord(word);
    const n = first + 1;
    note = (
      <InlineNote tone="error">
        {suggestion === null
          ? t('onboarding.import.badWord', { n, word })
          : t('onboarding.import.didYouMean', { n, word, suggestion })}
      </InlineNote>
    );
  } else if (checksum || props.error) {
    note = <InlineNote tone="error">{t('onboarding.import.invalid')}</InlineNote>;
  }
  return (
    <Step
      {...props.frame}
      title={t('onboarding.import.title')}
      hint={t('onboarding.import.hint')}
      footer={
        <BottomActions>
          <Button disabled={!filled || bad.length > 0} onClick={submit}>
            {t('onboarding.continue')}
          </Button>
        </BottomActions>
      }
    >
      <div class="ob-import-bar">
        <Segmented<PhraseLength>
          kind="radio"
          size="sm"
          label={t('onboarding.import.length')}
          options={[
            { value: '12', label: t('onboarding.import.words12') },
            { value: '24', label: t('onboarding.import.words24') },
          ]}
          value={length === 24 ? '24' : '12'}
          onChange={(v) => {
            edit([...cells], v === '24' ? 24 : 12);
          }}
        />
        <Button
          variant="ghost"
          icon="clipboard"
          label={t('onboarding.import.pasteLabel')}
          onClick={paste}
        >
          {t('onboarding.import.paste')}
        </Button>
      </div>
      <WordGrid
        words={words}
        invalid={bad}
        onWordInput={(i, value) => {
          const next = [...cells];
          next[i] = value.toLowerCase();
          edit(next);
        }}
        onPaste={(text, i) => {
          place(text, i);
        }}
      />
      {note}
    </Step>
  );
}

const STRENGTH = {
  weak: { key: 'onboarding.password.strength.weak', level: 1, tone: 'bad' },
  fair: { key: 'onboarding.password.strength.fair', level: 2, tone: 'warn' },
  strong: { key: 'onboarding.password.strength.strong', level: 3, tone: 'ok' },
} as const;

const PASSWORD_FORM = 'ob-password';

export function PasswordStep(props: {
  frame: StepFrame;
  mode: 'create' | 'import';
  mnemonic: string;
  onCreated: () => void;
  /** The phrase was refused: go back to fix it. */
  onBadPhrase: () => void;
}) {
  const client = useClient();
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const short = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
  const mismatch = repeat.length > 0 && repeat !== password;
  const ready = password.length >= MIN_PASSWORD_LENGTH && repeat === password;
  const strength = STRENGTH[strengthOf(password)];
  const submit = async (e: Event) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    const method = props.mode === 'create' ? 'wallet.createWallet' : 'wallet.importWallet';
    const res = await client.call(method, { password, mnemonic: props.mnemonic });
    if (res.ok) {
      props.onCreated();
      return;
    }
    setBusy(false);
    if (res.error.code === WalletErrorCodes.invalidMnemonic) props.onBadPhrase();
    else if (res.error.code === WalletErrorCodes.alreadyInitialised)
      setError(t('onboarding.password.exists'));
    else if (res.error.code === WalletErrorCodes.passwordTooShort)
      setError(t('onboarding.password.tooShort', { min: MIN_PASSWORD_LENGTH }));
    else setError(t('app.error.generic'));
  };
  return (
    <Step
      {...props.frame}
      gap={14}
      title={t('onboarding.password.title')}
      hint={t('onboarding.password.hint')}
      footer={
        <BottomActions>
          <Button type="submit" form={PASSWORD_FORM} disabled={!ready || busy}>
            {t('onboarding.continue')}
          </Button>
        </BottomActions>
      }
    >
      <form id={PASSWORD_FORM} class="ob-form" onSubmit={(e) => void submit(e)}>
        <PasswordField
          label={t('onboarding.password.label')}
          showPasswordLabel={t('onboarding.password.show')}
          hidePasswordLabel={t('onboarding.password.hide')}
          value={password}
          disabled={busy}
          autoFocus
          autoComplete="new-password"
          error={
            short ? t('onboarding.password.tooShort', { min: MIN_PASSWORD_LENGTH }) : undefined
          }
          onInput={setPassword}
          meter={
            password.length > 0 && (
              <StrengthMeter level={strength.level} tone={strength.tone} label={t(strength.key)} />
            )
          }
        />
        <Field
          label={t('onboarding.password.repeat')}
          type="password"
          value={repeat}
          disabled={busy}
          autoComplete="new-password"
          error={mismatch ? t('onboarding.password.mismatch') : undefined}
          success={ready ? t('onboarding.password.match') : undefined}
          onInput={setRepeat}
        />
        {error !== null && <Banner tone="red">{error}</Banner>}
        {busy && (
          <p class="ob-wait" role="status">
            <Spinner /> {t('onboarding.password.working')}
          </p>
        )}
      </form>
    </Step>
  );
}

/** A token's avatar colour, and its kit's swatches in the scheme shown now when it has a kit. */
function tokenLook(token: ListedToken, scheme: Scheme) {
  const hasKit = token.branding !== null || token.denom === BZE_DENOM;
  const kit = resolveKit(
    { denom: token.denom, branding: token.branding, brandThemes: true },
    scheme,
  );
  return {
    hasKit,
    color: tokenColor(token),
    swatches: hasKit ? [kit.bg, kit.primary, kit.secondary] : undefined,
  };
}

type StartError = 'noSuchToken' | 'invalid' | 'failed';

const START_ERRORS = {
  noSuchToken: 'onboarding.start.noSuchToken',
  invalid: 'onboarding.start.invalid',
  failed: 'onboarding.start.failed',
} as const;

/** How long typing pauses before the code is looked up. */
const LOOKUP_DELAY_MS = 400;

export function Start(props: {
  frame: StepFrame;
  prefillCode: string | undefined;
  /** The site of the link the code came from; null or absent when typed. */
  linkHost?: string | null | undefined;
  /** The code came from a link whose site is not a known one. */
  warn?: boolean;
  /** A code found a token: the token step drops out of the flow. */
  onFound: (found: boolean) => void;
  onOpen: (denom: string) => Promise<boolean>;
  onPick: () => void;
}) {
  const client = useClient();
  const env = useOnboardingEnv();
  const scheme = useScheme();
  const [mode, setMode] = useState<'code' | 'manual' | null>(props.prefillCode ? 'code' : null);
  const [code, setCode] = useState(props.prefillCode ?? '');
  const [found, setFound] = useState<ListedToken | null>(null);
  const [error, setError] = useState<StartError | null>(null);
  const [busy, setBusy] = useState(false);
  // Only the latest lookup may land: an older, slower answer is dropped.
  const seq = useRef(0);
  const cancelTimer = useRef<() => void>(() => undefined);
  // Only a found token on the picked code card shortens the flow.
  const ready = mode === 'code' ? found : null;
  const { onFound } = props;
  useEffect(() => {
    onFound(ready !== null);
  }, [onFound, ready]);
  const lookup = async (value: string) => {
    cancelTimer.current();
    const trimmed = value.trim();
    const mine = ++seq.current;
    setError(null);
    setFound(null);
    if (trimmed === '') return;
    const res = await client.call('tokens.lookup', { code: trimmed });
    if (mine !== seq.current) return;
    if (res.ok) setFound(res.value);
    else if (res.error.code === TokenErrorCodes.noSuchToken) setError('noSuchToken');
    else if (res.error.code === TokenErrorCodes.invalidCode) setError('invalid');
    else setError('failed');
  };
  const typed = (value: string) => {
    setCode(value);
    seq.current++;
    setFound(null);
    setError(null);
    cancelTimer.current();
    cancelTimer.current = env.scheduler.after(LOOKUP_DELAY_MS, () => void lookup(value));
  };
  useEffect(() => {
    if (props.prefillCode) void lookup(props.prefillCode);
    // Only on mount: later lookups are the user's. Drop a pending lookup on leaving.
    return () => {
      cancelTimer.current();
      seq.current++;
    };
  }, []);
  const paste = () => {
    // Read only here, on the user's tap.
    void env.clipboard.readText().then(
      (text) => {
        const value = text.trim();
        setCode(value);
        void lookup(value);
      },
      () => undefined,
    );
  };
  const open = async () => {
    if (!found) return;
    setBusy(true);
    setError((await props.onOpen(found.denom)) ? null : 'failed');
    setBusy(false);
  };
  const look = found ? tokenLook(found, scheme) : null;
  const prefilled = props.prefillCode !== undefined && code === props.prefillCode;
  const codeBody = (
    <form
      class="ob-code"
      onSubmit={(e) => {
        e.preventDefault();
        void lookup(code);
      }}
    >
      <Field
        label={t('onboarding.start.codeLabel')}
        hideLabel
        mono
        value={code}
        placeholder={t('onboarding.start.codePlaceholder')}
        error={
          error === null
            ? undefined
            : error === 'noSuchToken'
              ? `${t('onboarding.start.noSuchToken')} ${t('onboarding.start.noSuchTokenHint')}`
              : t(START_ERRORS[error])
        }
        onInput={typed}
        trailing={
          <Button variant="ghost" label={t('onboarding.start.pasteLabel')} onClick={paste}>
            {t('onboarding.start.paste')}
          </Button>
        }
      />
      {prefilled && (
        <InlineNote tone="neutral" icon="link">
          {props.linkHost
            ? t('onboarding.start.prefilledFrom', { host: props.linkHost })
            : t('onboarding.start.prefilled')}
        </InlineNote>
      )}
      {props.warn === true && <Banner tone="amber">{t('addtoken.unknown')}</Banner>}
      {found && look && (
        <TokenRow
          variant="card"
          symbol={found.symbol}
          name={found.name}
          color={look.color}
          swatches={look.swatches}
          caption={look.hasKit ? t('onboarding.start.kit') : t('onboarding.start.noKit')}
        />
      )}
    </form>
  );
  return (
    <Step
      {...props.frame}
      title={t('onboarding.start.title')}
      hint={t('onboarding.start.hint')}
      footer={
        <BottomActions>
          {ready ? (
            <Button disabled={busy} onClick={() => void open()}>
              {t('onboarding.start.open', { symbol: ready.symbol })}
            </Button>
          ) : (
            <Button disabled={mode !== 'manual'} onClick={props.onPick}>
              {t('onboarding.continue')}
            </Button>
          )}
        </BottomActions>
      }
    >
      <RadioCardGroup<'code' | 'manual'>
        label={t('onboarding.start.title')}
        value={mode}
        onChange={setMode}
        options={[
          {
            value: 'code',
            icon: 'ticket',
            title: t('onboarding.start.haveCode'),
            subtitle: t('onboarding.start.haveCodeSub'),
            body: codeBody,
          },
          {
            value: 'manual',
            icon: 'grid',
            iconTone: 'inset',
            title: t('onboarding.start.choose'),
            subtitle: t('onboarding.start.chooseSub'),
          },
        ]}
      />
    </Step>
  );
}

export function Tokens(props: {
  frame: StepFrame;
  onFinish: (denoms: string[]) => Promise<boolean>;
}) {
  const client = useClient();
  const scheme = useScheme();
  const [query, setQuery] = useState('');
  const [list, setList] = useState<ListedToken[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);
  const [finishFailed, setFinishFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void client.call('tokens.search', { query }).then((res) => {
      if (!live) return;
      if (res.ok) {
        setList(res.value);
        setFailed(false);
      } else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [client, query]);
  const toggle = (denom: string) => {
    setSelected((s) => (s.includes(denom) ? s.filter((d) => d !== denom) : [...s, denom]));
  };
  const note =
    selected.length === 0
      ? t('onboarding.tokens.none')
      : selected.length === 1
        ? t('onboarding.tokens.selectedOne')
        : t('onboarding.tokens.selected', { count: selected.length });
  return (
    <Step
      {...props.frame}
      title={t('onboarding.tokens.title')}
      hint={t('onboarding.tokens.hint')}
      footer={
        <BottomBar note={note}>
          <Button
            disabled={selected.length === 0 || busy}
            onClick={() => {
              setBusy(true);
              setFinishFailed(false);
              void props.onFinish(selected).then((done) => {
                setBusy(false);
                setFinishFailed(!done);
              });
            }}
          >
            {t('onboarding.tokens.finish')}
          </Button>
        </BottomBar>
      }
    >
      <SearchField
        label={t('onboarding.tokens.search')}
        placeholder={t('onboarding.tokens.searchPlaceholder')}
        value={query}
        onInput={setQuery}
      />
      {(failed || finishFailed) && <Banner tone="red">{t('app.error.generic')}</Banner>}
      <div class="ob-tokens">
        {list?.map((tok) => {
          const look = tokenLook(tok, scheme);
          return (
            <TokenRow
              key={tok.denom}
              symbol={tok.symbol}
              name={tok.name}
              color={look.color}
              swatches={tok.unresolved ? undefined : look.swatches}
              caption={
                tok.unresolved
                  ? t('onboarding.tokens.unresolved')
                  : look.hasKit
                    ? t('onboarding.tokens.kit')
                    : t('onboarding.tokens.noKit')
              }
              checked={selected.includes(tok.denom)}
              onToggle={() => {
                toggle(tok.denom);
              }}
            />
          );
        })}
      </div>
      {list?.length === 0 && <p class="ob-wait">{t('onboarding.tokens.empty')}</p>}
    </Step>
  );
}
