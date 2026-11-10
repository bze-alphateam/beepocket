import type { NetworkId } from '@beepocket/core';
import { useCallback, useEffect, useState } from 'preact/hooks';
import { t } from '../../i18n';
import { useClient } from '../../popup/client-context';
import { WalletErrorCodes, type WalletSettings } from '../../protocol';

/** What the Settings rows show; read each time a page opens. */
export interface SettingsData {
  settings: WalletSettings;
  network: NetworkId;
  tokens: number;
  contacts: number;
  sites: number;
}

export interface SettingsState {
  data: SettingsData | null;
  failed: boolean;
  /** The message of the last refused change, shown as a banner. */
  error: string | null;
  setData: (data: SettingsData) => void;
  setError: (message: string | null) => void;
  reload: () => Promise<void>;
  save: (patch: Partial<WalletSettings>) => Promise<void>;
}

/** Reads the rows' data when the page opens and saves setting changes with their error banners. */
export function useSettingsData(): SettingsState {
  const client = useClient();
  const [data, setData] = useState<SettingsData | null>(null);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [settings, network, tokens, book, sites] = await Promise.all([
      client.call('settings.get', {}),
      client.call('network.get', {}),
      client.call('tokens.preferred', {}),
      client.call('book.list', {}),
      client.call('sites.list', {}),
    ]);
    if (!settings.ok || !network.ok) {
      setFailed(true);
      return;
    }
    setFailed(false);
    setData({
      settings: settings.value,
      network: network.value.id,
      tokens: tokens.ok ? tokens.value.length : 0,
      contacts: book.ok ? book.value.contacts.length : 0,
      sites: sites.ok ? sites.value.sites.length : 0,
    });
  }, [client]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = async (patch: Partial<WalletSettings>) => {
    setError(null);
    const r = await client.call('settings.set', patch);
    if (r.ok) {
      setData((d) => d && { ...d, settings: r.value });
      return;
    }
    // Shows what is stored again (a switch flipped before the save goes back).
    void reload();
    if (r.error.code === WalletErrorCodes.invalidSettings) setError(t('settings.invalid'));
    else if (r.error.code === WalletErrorCodes.needsPassword) setError(t('settings.needsUnlock'));
    else setError(t('settings.saveFailed'));
  };

  return { data, failed, error, setData, setError, reload, save };
}
