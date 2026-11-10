import { NETWORKS, type NetworkId } from '@beepocket/core';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../../i18n';
import { useClient } from '../../popup/client-context';
import { Layout } from '../../popup/Layout';
import { useRoute, type RouteBase } from '../../popup/router';
import { Button, Logo, ScreenHeader } from '../../ui';
import { homeTarget } from '../lock/targets';
import { useSettingsEnv } from './env';

/** Where each Settings page's ← goes: one level up. The root has none. */
export const SETTINGS_PARENT = {
  'settings.configuration': { name: 'settings.main' },
  'settings.pickTokens': { name: 'settings.main' },
  'settings.book': { name: 'settings.main' },
  'settings.appearance': { name: 'settings.configuration' },
  'settings.security': { name: 'settings.configuration' },
  'settings.advanced': { name: 'settings.configuration' },
  'dapp.sites': { name: 'settings.configuration' },
  'settings.timers': { name: 'settings.security' },
  'settings.reveal': { name: 'settings.security' },
} as const satisfies Record<string, RouteBase>;

/** The footer: the logo, the version and the chain; `links` sits under them. */
export function SettingsFooter(props: {
  version: string;
  chainId: string;
  links?: ComponentChildren;
}) {
  return (
    <footer class="bp-settings-footer">
      <span class="bp-settings-footer-line">
        <Logo size={20} />
        {t('settings.footer', { version: props.version, chain: props.chainId })}
      </span>
      {props.links}
    </footer>
  );
}

export interface SettingsPageProps {
  title: string;
  /** Where ← goes; none on the root (and on Manage tokens when it is the only way out). */
  parent?: RouteBase | undefined;
  backLabel?: string | undefined;
  /** Left of the ×: a network pill. */
  right?: ComponentChildren;
  /** Pinned above the version footer: the page's primary action (Save, Hide). */
  actions?: ComponentChildren;
  /** The network the footer names; read from the wallet when not given. */
  network?: NetworkId | undefined;
  children?: ComponentChildren;
}

/**
 * The one frame of every Settings page, so they cannot drift apart: the title with ← (one level up)
 * and × (back to Home from any depth) on top, the content scrolling in the middle, the page's
 * action and the version footer pinned at the bottom. Escape goes up one level, or to Home from
 * the root; a dropdown or dialog open on the page takes the key first.
 */
export function SettingsPage(props: SettingsPageProps) {
  const client = useClient();
  const env = useSettingsEnv();
  const { navigate } = useRoute<RouteBase>();
  const [read, setRead] = useState<NetworkId | null>(null);
  const network = props.network ?? read;

  useEffect(() => {
    let live = true;
    void client.call('network.get', {}).then((r) => {
      if (live && r.ok) setRead(r.value.id);
    });
    return () => {
      live = false;
    };
  }, [client]);

  const parent = props.parent;
  const leave = useRef<() => void>(() => undefined);
  leave.current = () => {
    navigate(parent ?? homeTarget);
  };
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('.bp-sheet-root') !== null) return;
      leave.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return (
    <Layout
      header={
        <ScreenHeader
          title={props.title}
          backLabel={props.backLabel}
          onBack={
            parent === undefined
              ? undefined
              : () => {
                  navigate(parent);
                }
          }
          right={
            <>
              {props.right}
              <Button
                variant="icon"
                icon="x"
                label={t('settings.close')}
                onClick={() => {
                  navigate(homeTarget);
                }}
              />
            </>
          }
        />
      }
      footer={
        <>
          {props.actions}
          <SettingsFooter
            version={env.manifest.version()}
            chainId={network === null ? '' : NETWORKS[network].chainId}
          />
        </>
      }
    >
      <div class="bp-settings-page">{props.children}</div>
    </Layout>
  );
}
