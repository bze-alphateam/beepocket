import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { t } from '../../i18n';
import type { ListedToken } from '../../protocol';
import { useClient } from '../../popup/client-context';
import { useScheme } from '../../popup/appearance';
import { BZE_DENOM, resolveKit, type Scheme } from '../../theme';
import { Banner, SearchField, TokenRow } from '../../ui';
import { tokenColor } from '../home/format';

/** A token's avatar colour, and its kit's swatches in the scheme shown now when it has a kit. */
export function tokenLook(token: ListedToken, scheme: Scheme) {
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

export interface TokenPickerProps {
  /** Denoms ticked now. */
  selected: readonly string[];
  onToggle: (denom: string) => void;
  /** Between the search field and the list: a failed-save banner, a note. */
  notice?: ComponentChildren;
  /** Right under the search field: another way to find a token (Settings' token code). */
  field?: ComponentChildren;
  /**
   * Tokens the search cannot find, listed ahead of its answer when they match the query: the picks
   * the wallet does not hold, a token found by its code. A denom the answer also has keeps the
   * answer's place.
   */
  extra?: readonly ListedToken[];
}

/**
 * The token picker of onboarding (`Ob-Tokens`) and Settings › Preferred tokens: a search over
 * ubze and every token the wallet holds, one tickable row per token. A search that could not read
 * every address still lists what it found, under the error banner.
 */
export function TokenPicker({ selected, onToggle, notice, field, extra = [] }: TokenPickerProps) {
  const client = useClient();
  const scheme = useScheme();
  const [query, setQuery] = useState('');
  const [list, setList] = useState<ListedToken[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    void client.call('tokens.search', { query }).then((res) => {
      if (!live) return;
      if (res.ok) {
        setList(res.value.tokens);
        setFailed(res.value.partial);
      } else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [client, query]);
  // The same match `tokens.search` applies to its answer.
  const needle = query.trim().toLowerCase();
  const matches = (x: ListedToken) =>
    needle === '' ||
    x.symbol.toLowerCase().includes(needle) ||
    x.name.toLowerCase().includes(needle) ||
    x.denom.toLowerCase().includes(needle);
  const rows =
    list === null
      ? null
      : [...extra.filter((x) => matches(x) && !list.some((l) => l.denom === x.denom)), ...list];
  return (
    <>
      <SearchField
        label={t('onboarding.tokens.search')}
        placeholder={t('onboarding.tokens.searchPlaceholder')}
        value={query}
        onInput={setQuery}
      />
      {field}
      {failed && <Banner tone="red">{t('app.error.generic')}</Banner>}
      {notice}
      <div class="ob-tokens">
        {rows?.map((tok) => {
          const look = tokenLook(tok, scheme);
          return (
            <TokenRow
              key={tok.denom}
              symbol={tok.symbol}
              name={tok.name}
              color={look.color}
              logo={tok.logo}
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
                onToggle(tok.denom);
              }}
            />
          );
        })}
      </div>
      {rows?.length === 0 && <p class="ob-wait">{t('onboarding.tokens.empty')}</p>}
    </>
  );
}
