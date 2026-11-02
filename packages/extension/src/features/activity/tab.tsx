import { t } from '../../i18n';
import { registerHomeTab } from '../home/tabs';
import { ActivityFilterChip, ActivityTab } from './ActivityTab';
import { createAddressFilter } from './filter';

/** Fills the Activity slot of the token home: the list, and its address chip in the tabs row. */
export function registerActivityTab(): void {
  const filter = createAddressFilter();
  registerHomeTab({
    id: 'activity',
    label: t('home.tab.activity'),
    render: (ctx) => (
      <ActivityTab
        key={ctx.token.denom}
        tokens={ctx.tokens}
        addresses={ctx.addresses}
        balances={ctx.balances}
        filter={filter}
      />
    ),
    action: (ctx) => <ActivityFilterChip addresses={ctx.addresses} filter={filter} />,
  });
}
