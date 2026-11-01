import { t } from '../../i18n';
import { registerHomeTab } from '../home/tabs';
import { ActivityTab } from './ActivityTab';

/** Fills the Activity slot of the token home. */
export function registerActivityTab(): void {
  registerHomeTab({
    id: 'activity',
    label: t('home.tab.activity'),
    render: (ctx) => (
      <ActivityTab
        key={ctx.token.denom}
        token={ctx.token}
        addresses={ctx.addresses}
        balances={ctx.balances}
      />
    ),
  });
}
