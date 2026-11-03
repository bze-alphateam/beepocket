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
}

/**
 * The token picker of onboarding (`Ob-Tokens`) and Settings › Preferred tokens: a search over
 * ubze and every token the wallet holds, one tickable row per token.
 */
export function TokenPicker({ selected, onToggle, notice }: TokenPickerProps) {
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
        setList(res.value);
        setFailed(false);
      } else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [client, query]);
  return (
    <>
      <SearchField
        label={t('onboarding.tokens.search')}
        placeholder={t('onboarding.tokens.searchPlaceholder')}
        value={query}
        onInput={setQuery}
      />
      {failed && <Banner tone="red">{t('app.error.generic')}</Banner>}
      {notice}
      <div class="ob-tokens">
        {list?.map((tok) => {
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
      {list?.length === 0 && <p class="ob-wait">{t('onboarding.tokens.empty')}</p>}
    </>
  );
}
