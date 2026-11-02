import type { NetworkId } from '@beepocket/core';
import type { Deliverer } from './deliver';
import type { DocumentLog } from './documents';

/** Which documents to tell: those of one site on one network, or all of them. */
export type Audience = { origin: string; network: NetworkId } | 'all';

export interface AccountChangesDeps {
  documents: Pick<DocumentLog, 'list' | 'drop'>;
  deliverer: Pick<Deliverer, 'push'>;
}

/**
 * Tells open pages that what a site sees has changed. The event carries no data: the page has
 * to call `getKey` again. A page that cannot be reached is gone and is forgotten.
 */
export class AccountChanges {
  constructor(private readonly deps: AccountChangesDeps) {}

  async notify(audience: Audience): Promise<void> {
    const all = await this.deps.documents.list();
    const targets =
      audience === 'all'
        ? all
        : all.filter((d) => d.origin === audience.origin && d.network === audience.network);
    const sent = await Promise.all(
      targets.map(async (d) => ((await this.deps.deliverer.push(d, 'accountChanged')) ? null : d)),
    );
    const gone = sent.flatMap((d) => (d === null ? [] : [d.documentId]));
    if (gone.length > 0) await this.deps.documents.drop(gone);
  }
}
