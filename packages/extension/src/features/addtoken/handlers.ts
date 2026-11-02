import { ok } from '../../protocol';
import type { HandlerRegistry } from '../../background/registry';
import type { AddTokenService } from './service';

/** The add-a-token window's two calls. Own pages only. */
export function registerAddTokenHandlers(
  registry: HandlerRegistry,
  service: AddTokenService,
): void {
  registry.register('addtoken.current', {
    validate: () => ok({}),
    handle: async () => ok(await service.current()),
  });
  registry.register('addtoken.clear', {
    validate: () => ok({}),
    handle: async () => {
      await service.clear();
      return ok({});
    },
  });
}
