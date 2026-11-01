import { ErrorCodes, fail, ok } from '../../protocol';
import type { HandlerDeps } from '../../background/handlers';
import type { HandlerRegistry } from '../../background/registry';

/** The home screen's one read: the active network and whether brand themes are on. */
export function registerHomeHandlers(
  registry: HandlerRegistry,
  deps: Pick<HandlerDeps, 'services' | 'wallet'>,
): void {
  registry.register('home.context', {
    validate: (payload) =>
      payload === undefined || payload === null || typeof payload === 'object'
        ? ok({})
        : fail(ErrorCodes.badRequest, 'home.context takes no payload.'),
    handle: async () => {
      const { network } = await deps.services.clients();
      const profile = await deps.wallet.getProfile();
      return ok({
        network: network.id,
        brandThemes: profile.ok ? profile.value.settings.brandThemes : true,
      });
    },
  });
}
