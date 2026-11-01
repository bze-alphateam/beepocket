import { t } from '../i18n';

export function Spinner() {
  return <span class="bp-spinner" role="status" aria-label={t('app.loading')} />;
}
