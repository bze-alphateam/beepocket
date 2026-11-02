import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { DenomBranding } from '@beepocket/core';
import { t } from '../../i18n';
import { TokenErrorCodes, WalletErrorCodes, type ListedToken } from '../../protocol';
import { useClient } from '../../popup/client-context';
import { Banner, Button, Pill, Spinner, TextField } from '../../ui';
import { themeVars } from '../../theme';
import { useRandom } from './random';
import { makeQuiz, type QuizQuestion } from './quiz';
import { MIN_PASSWORD_LENGTH, strengthOf } from './password';

/** Chrome of every step after Welcome: progress bars, back and the title block. */
export function Step(props: {
  index: number;
  total: number;
  title: string;
  hint?: string;
  onBack?: () => void;
  children: ComponentChildren;
}) {
  return (
    <section class="ob-step">
      <div class="ob-top">
        {props.onBack && (
          <button
            type="button"
            class="ob-back"
            aria-label={t('onboarding.back')}
            onClick={props.onBack}
          >
            ‹
          </button>
        )}
        <div
          class="ob-bars"
          role="img"
          aria-label={t('onboarding.progress', { step: props.index + 1, total: props.total })}
        >
          {Array.from({ length: props.total }, (_, i) => (
            <span key={i} class={i <= props.index ? 'ob-bar ob-bar-on' : 'ob-bar'} />
          ))}
        </div>
      </div>
      <h1>{props.title}</h1>
      {props.hint !== undefined && <p class="ob-hint">{props.hint}</p>}
      {props.children}
    </section>
  );
}

export function Welcome(props: {
  onCreate: () => void;
  onImport: () => void;
  /** "Setting up for GOLD · Link from …" when an add-a-token link started the flow. */
  strip?: string | undefined;
}) {
  return (
    <section class="ob-welcome">
      {props.strip !== undefined && <p class="ob-link-strip">{props.strip}</p>}
      <img src="icons/icon-128.png" width="72" height="72" alt="" />
      <h1>{t('onboarding.welcome.title')}</h1>
      <p class="ob-hint">{t('onboarding.welcome.tagline')}</p>
      <div class="ob-actions">
        <Button onClick={props.onCreate}>{t('onboarding.welcome.create')}</Button>
        <Button variant="quiet" onClick={props.onImport}>
          {t('onboarding.welcome.import')}
        </Button>
      </div>
      <small class="ob-note">{t('onboarding.welcome.selfCustody')}</small>
    </section>
  );
}

export function Phrase(props: {
  phrase: string | null;
  failed: boolean;
  onRetry: () => void;
  onContinue: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  if (props.failed) {
    return (
      <>
        <Banner tone="red">{t('app.error.generic')}</Banner>
        <Button variant="quiet" onClick={props.onRetry}>
          {t('onboarding.phrase.retry')}
        </Button>
      </>
    );
  }
  if (props.phrase === null) {
    return (
      <p class="ob-hint">
        <Spinner /> {t('onboarding.phrase.loading')}
      </p>
    );
  }
  const phrase = props.phrase;
  const copy = () => {
    // Clipboard failures are not worth blocking the flow on.
    void navigator.clipboard.writeText(phrase).then(
      () => {
        setCopied(true);
      },
      () => undefined,
    );
  };
  return (
    <>
      <Banner tone="amber">{t('onboarding.phrase.warning')}</Banner>
      <div class="ob-words-wrap">
        {revealed ? (
          <ol class="ob-words">
            {phrase.split(' ').map((w, i) => (
              <li key={i} aria-label={t('onboarding.phrase.wordLabel', { n: i + 1 })}>
                <b>{i + 1}</b>
                {w}
              </li>
            ))}
          </ol>
        ) : (
          <ol class="ob-words ob-blur" aria-hidden="true">
            {Array.from({ length: 24 }, (_, i) => (
              <li key={i}>
                <b>{i + 1}</b>
                <span class="ob-ph" />
              </li>
            ))}
          </ol>
        )}
        {!revealed && (
          <div class="ob-veil">
            <Button
              onClick={() => {
                setRevealed(true);
              }}
            >
              {t('onboarding.phrase.reveal')}
            </Button>
            <small>{t('onboarding.phrase.privacy')}</small>
          </div>
        )}
      </div>
      {revealed && (
        <>
          <Button variant="quiet" onClick={copy}>
            {copied ? t('onboarding.phrase.copied') : t('onboarding.phrase.copy')}
          </Button>
          <label class="ob-check">
            <input
              type="checkbox"
              checked={saved}
              onChange={(e) => {
                setSaved(e.currentTarget.checked);
              }}
            />
            {t('onboarding.phrase.saved')}
          </label>
        </>
      )}
      <Button disabled={!revealed || !saved} onClick={props.onContinue}>
        {t('onboarding.continue')}
      </Button>
    </>
  );
}

export function Confirm(props: { phrase: string; onDone: () => void }) {
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
    <>
      {quiz.map((q) => (
        <fieldset key={q.position} class="ob-quiz">
          <legend>{t('onboarding.confirm.position', { n: q.position })}</legend>
          {q.options.map((w) => (
            <button
              key={w}
              type="button"
              class={picks[q.position] === w ? 'ob-opt ob-opt-on' : 'ob-opt'}
              aria-pressed={picks[q.position] === w}
              onClick={() => {
                setWrong(false);
                setPicks({ ...picks, [q.position]: w });
              }}
            >
              {w}
            </button>
          ))}
        </fieldset>
      ))}
      {wrong && <Banner tone="red">{t('onboarding.confirm.wrong')}</Banner>}
      <Button disabled={quiz.some((q) => picks[q.position] === undefined)} onClick={submit}>
        {t('onboarding.continue')}
      </Button>
    </>
  );
}

export const wordsOf = (text: string): string[] =>
  text.trim().toLowerCase().split(/\s+/).filter(Boolean);

export function ImportPhrase(props: {
  value: string;
  error: boolean;
  onInput: (v: string) => void;
  onDone: () => void;
}) {
  const count = wordsOf(props.value).length;
  const valid = count === 12 || count === 24;
  return (
    <>
      <div class="bp-field">
        <label for="ob-phrase">{t('onboarding.import.label')}</label>
        <textarea
          id="ob-phrase"
          class="ob-area"
          rows={5}
          value={props.value}
          autoComplete="off"
          spellcheck={false}
          onInput={(e) => {
            props.onInput(e.currentTarget.value);
          }}
        />
      </div>
      {count > 0 && (
        <small class={valid ? 'ob-note' : 'ob-note ob-bad'}>
          {valid
            ? t('onboarding.import.count', { count })
            : t('onboarding.import.countBad', { count })}
        </small>
      )}
      {props.error && <Banner tone="red">{t('onboarding.import.invalid')}</Banner>}
      <Button disabled={!valid} onClick={props.onDone}>
        {t('onboarding.continue')}
      </Button>
    </>
  );
}

const STRENGTH = {
  weak: 'onboarding.password.strength.weak',
  fair: 'onboarding.password.strength.fair',
  strong: 'onboarding.password.strength.strong',
} as const;

export function PasswordStep(props: {
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
  const strength = strengthOf(password);
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
    <form class="ob-form" onSubmit={(e) => void submit(e)}>
      <TextField
        label={t('onboarding.password.label')}
        type="password"
        value={password}
        disabled={busy}
        autoFocus
        {...(short
          ? { error: t('onboarding.password.tooShort', { min: MIN_PASSWORD_LENGTH }) }
          : {})}
        onInput={setPassword}
      />
      {password.length > 0 && (
        <Pill>
          <span data-strength={strength}>{t(STRENGTH[strength])}</span>
        </Pill>
      )}
      <TextField
        label={t('onboarding.password.repeat')}
        type="password"
        value={repeat}
        disabled={busy}
        {...(mismatch ? { error: t('onboarding.password.mismatch') } : {})}
        onInput={setRepeat}
      />
      {ready && <small class="ob-note ob-ok">{t('onboarding.password.match')}</small>}
      {error !== null && <Banner tone="red">{error}</Banner>}
      {busy ? (
        <p class="ob-hint">
          <Spinner /> {t('onboarding.password.working')}
        </p>
      ) : null}
      <Button type="submit" disabled={!ready || busy}>
        {t('onboarding.continue')}
      </Button>
    </form>
  );
}

/** A throwaway theme for one token card: the theme engine's variables applied to the card only. */
function kitStyle(denom: string, branding: DenomBranding | null): Record<string, string> {
  // The popup's scheme, as applied to the document by the theme engine.
  const scheme = document.documentElement.dataset.scheme === 'light' ? 'light' : 'dark';
  return themeVars({ denom, branding, brandThemes: true, scheme });
}

export function TokenCard(props: { token: ListedToken; note?: string }) {
  const { token } = props;
  const style = kitStyle(token.denom, token.branding);
  return (
    <div class="ob-token" style={style} data-denom={token.denom}>
      <span class="ob-dot" aria-hidden="true">
        {token.symbol.slice(0, 1)}
      </span>
      <div>
        <b>{token.symbol}</b> · {token.name}
        <small>{props.note}</small>
      </div>
    </div>
  );
}

type StartError = 'noSuchToken' | 'invalid' | 'failed';

const START_ERRORS = {
  noSuchToken: 'onboarding.start.noSuchToken',
  invalid: 'onboarding.start.invalid',
  failed: 'onboarding.start.failed',
} as const;

export function Start(props: {
  prefillCode: string | undefined;
  /** The code came from a link whose site is not a known one. */
  warn?: boolean;
  onOpen: (denom: string) => Promise<boolean>;
  onPick: () => void;
}) {
  const client = useClient();
  const [mode, setMode] = useState<'none' | 'code'>(props.prefillCode ? 'code' : 'none');
  const [code, setCode] = useState(props.prefillCode ?? '');
  const [found, setFound] = useState<ListedToken | null>(null);
  const [error, setError] = useState<StartError | null>(null);
  const [busy, setBusy] = useState(false);
  const lookup = async (value: string) => {
    const trimmed = value.trim();
    if (trimmed === '') return;
    setBusy(true);
    setError(null);
    setFound(null);
    const res = await client.call('tokens.lookup', { code: trimmed });
    setBusy(false);
    if (res.ok) setFound(res.value);
    else if (res.error.code === TokenErrorCodes.noSuchToken) setError('noSuchToken');
    else if (res.error.code === TokenErrorCodes.invalidCode) setError('invalid');
    else setError('failed');
  };
  useEffect(() => {
    if (props.prefillCode) void lookup(props.prefillCode);
    // Only on mount: later lookups are the user's.
  }, []);
  const open = async () => {
    if (!found) return;
    setBusy(true);
    setError((await props.onOpen(found.denom)) ? null : 'failed');
    setBusy(false);
  };
  return (
    <>
      <button
        type="button"
        class={mode === 'code' ? 'ob-card ob-card-on' : 'ob-card'}
        onClick={() => {
          setMode('code');
        }}
      >
        <b>{t('onboarding.start.haveCode')}</b>
        <small>{t('onboarding.start.haveCodeSub')}</small>
      </button>
      {mode === 'code' && (
        <form
          class="ob-form"
          onSubmit={(e) => {
            e.preventDefault();
            void lookup(code);
          }}
        >
          <TextField
            label={t('onboarding.start.codeLabel')}
            value={code}
            placeholder={t('onboarding.start.codePlaceholder')}
            onInput={(v) => {
              setCode(v);
              setFound(null);
              setError(null);
            }}
          />
          {props.prefillCode !== undefined && code === props.prefillCode && (
            <small class="ob-note">{t('onboarding.start.prefilled')}</small>
          )}
          {props.warn === true && <Banner tone="amber">{t('addtoken.unknown')}</Banner>}
          {error !== null && (
            <Banner tone="red">
              {t(START_ERRORS[error])}
              {error === 'noSuchToken' && <small> {t('onboarding.start.noSuchTokenHint')}</small>}
            </Banner>
          )}
          {found && (
            <TokenCard
              token={found}
              note={found.branding ? t('onboarding.start.kit') : t('onboarding.start.noKit')}
            />
          )}
          {found ? (
            <Button disabled={busy} onClick={() => void open()}>
              {t('onboarding.start.open', { symbol: found.symbol })}
            </Button>
          ) : (
            <Button type="submit" disabled={busy || code.trim() === ''}>
              {busy ? t('onboarding.start.looking') : t('onboarding.start.lookup')}
            </Button>
          )}
        </form>
      )}
      <button type="button" class="ob-card" onClick={props.onPick}>
        <b>{t('onboarding.start.choose')}</b>
        <small>{t('onboarding.start.chooseSub')}</small>
      </button>
    </>
  );
}

export function Tokens(props: { onFinish: (denoms: string[]) => Promise<boolean> }) {
  const client = useClient();
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
  const summary =
    selected.length === 1
      ? t('onboarding.tokens.selectedOne')
      : t('onboarding.tokens.selected', { count: selected.length });
  return (
    <>
      <TextField label={t('onboarding.tokens.search')} value={query} onInput={setQuery} />
      {(failed || finishFailed) && <Banner tone="red">{t('app.error.generic')}</Banner>}
      <ul class="ob-list">
        {list?.map((tok) => {
          const on = selected.includes(tok.denom);
          return (
            <li key={tok.denom}>
              <label class={on ? 'ob-row ob-row-on' : 'ob-row'}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => {
                    toggle(tok.denom);
                  }}
                />
                <span class="ob-dot" aria-hidden="true">
                  {tok.symbol.slice(0, 1)}
                </span>
                <span>
                  <b>{tok.symbol}</b> · {tok.name}
                  <small>
                    {tok.unresolved
                      ? t('onboarding.tokens.unresolved')
                      : tok.branding
                        ? t('onboarding.tokens.kit')
                        : t('onboarding.tokens.noKit')}
                  </small>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {list?.length === 0 && <p class="ob-hint">{t('onboarding.tokens.empty')}</p>}
      <small class="ob-note">{selected.length === 0 ? t('onboarding.tokens.none') : summary}</small>
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
    </>
  );
}
