import {
  ErrorCodes,
  fail,
  ok,
  WalletErrorCodes,
  type Result,
  type WalletSettings,
} from '../../protocol';
import type { HandlerRegistry } from '../../background/registry';
import { isAppearance } from '../../theme/appearance';
import { isLockChoice } from './lock-options';
import { isNetworkId, type SettingsService } from './service';

type Payload = Record<string, unknown>;

const bad = (message: string): Result<never> => fail(ErrorCodes.badRequest, message);

function asObject(payload: unknown): Payload | null {
  if (payload === undefined || payload === null) return {};
  return typeof payload === 'object' && !Array.isArray(payload) ? (payload as Payload) : null;
}

const noArgs = (): Result<Record<string, never>> => ok({});

/** Only known fields of the right type pass; range rules belong to the handler and the wallet. */
function validatePatch(payload: unknown): Result<Partial<WalletSettings>> {
  const p = asObject(payload);
  if (!p) return bad('settings.set got a malformed request.');
  const patch: Partial<WalletSettings> = {};
  if (p.brandThemes !== undefined) {
    if (typeof p.brandThemes !== 'boolean') return bad('brandThemes must be a boolean.');
    patch.brandThemes = p.brandThemes;
  }
  for (const key of ['weakLockMinutes', 'fullLockMinutes'] as const) {
    const value = p[key];
    if (value === undefined) continue;
    if (typeof value !== 'number') return bad(`${key} must be a number.`);
    patch[key] = value;
  }
  return ok(patch);
}

/** Thin protocol layer for settings and the network switch. */
export function registerSettingsHandlers(
  registry: HandlerRegistry,
  service: SettingsService,
): void {
  registry.register('settings.get', { validate: noArgs, handle: () => service.get() });
  registry.register('settings.set', {
    validate: validatePatch,
    // A lock time must be one Settings offers; the wallet then checks full lock ≥ weak lock.
    handle: async (patch) =>
      [patch.weakLockMinutes, patch.fullLockMinutes].every(
        (m) => m === undefined || isLockChoice(m),
      )
        ? service.set(patch)
        : fail(WalletErrorCodes.invalidSettings, 'A lock time must be one of the offered ones.'),
  });
  registry.register('network.get', {
    validate: noArgs,
    handle: async () => ok(await service.network()),
  });
  registry.register('network.set', {
    validate: (payload) => {
      const id = asObject(payload)?.id;
      return isNetworkId(id) ? ok({ id }) : bad('network.set needs a known network id.');
    },
    handle: ({ id }) => service.setNetwork(id),
  });
  registry.register('appearance.get', {
    validate: noArgs,
    handle: async () => ok(await service.appearance()),
  });
  registry.register('appearance.set', {
    validate: (payload) => {
      const appearance = asObject(payload)?.appearance;
      return isAppearance(appearance)
        ? ok({ appearance })
        : bad('appearance.set needs dark, light or system.');
    },
    handle: ({ appearance }) => service.setAppearance(appearance),
  });
}
