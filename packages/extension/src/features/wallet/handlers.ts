import { ErrorCodes, fail, ok, type Method, type RequestOf, type Result } from '../../protocol';
import type { Handler, HandlerRegistry } from '../../background/registry';
import type { WalletService } from './service';

type Payload = Record<string, unknown>;

function asObject(payload: unknown): Payload | null {
  if (payload === undefined || payload === null) return {};
  return typeof payload === 'object' && !Array.isArray(payload) ? (payload as Payload) : null;
}

const bad = (message: string): Result<never> => fail(ErrorCodes.badRequest, message);

/** Wraps a field check into a `validate` that rejects anything but the expected shape. */
function fields<M extends Method>(
  name: string,
  check: (p: Payload) => RequestOf<M> | null,
): (payload: unknown) => Result<RequestOf<M>> {
  return (payload) => {
    const obj = asObject(payload);
    const value = obj && check(obj);
    return value ? ok(value) : bad(`${name} got a malformed request.`);
  };
}

const none = (name: string) =>
  fields<never>(name, () => ({}) as never) as (payload: unknown) => Result<Record<string, never>>;

const withPassword = (name: string) =>
  fields<'wallet.unlock'>(name, (p) =>
    typeof p.password === 'string' ? { password: p.password } : null,
  );

const withPhrase = (name: string) =>
  fields<'wallet.createWallet'>(name, (p) =>
    typeof p.password === 'string' && typeof p.mnemonic === 'string'
      ? { password: p.password, mnemonic: p.mnemonic }
      : null,
  );

/** Thin protocol layer: validates payloads and delegates to the service. */
export function registerWalletHandlers(registry: HandlerRegistry, wallet: WalletService): void {
  const reg = <M extends Method>(method: M, handler: Handler<M>): void => {
    registry.register(method, handler);
  };

  reg('wallet.state', {
    validate: none('wallet.state'),
    handle: async () => ok(await wallet.state()),
  });
  reg('wallet.generateMnemonic', {
    validate: none('wallet.generateMnemonic'),
    handle: () => Promise.resolve(ok({ mnemonic: wallet.generateMnemonic() })),
  });
  reg('wallet.createWallet', {
    validate: withPhrase('wallet.createWallet'),
    handle: (r) => wallet.createWallet(r.password, r.mnemonic),
  });
  reg('wallet.importWallet', {
    validate: withPhrase('wallet.importWallet'),
    handle: (r) => wallet.importWallet(r.password, r.mnemonic),
  });
  reg('wallet.unlock', {
    validate: withPassword('wallet.unlock'),
    handle: (r) => wallet.unlock(r.password),
  });
  reg('wallet.lock', {
    validate: none('wallet.lock'),
    handle: async () => {
      await wallet.lock();
      return ok({});
    },
  });
  reg('wallet.reauth', {
    validate: withPassword('wallet.reauth'),
    handle: (r) => wallet.reauth(r.password),
  });
  reg('wallet.revealMnemonic', {
    validate: withPassword('wallet.revealMnemonic'),
    handle: (r) => wallet.revealMnemonic(r.password),
  });
  reg('wallet.addresses', { validate: none('wallet.addresses'), handle: () => wallet.addresses() });
  reg('wallet.previewNext', {
    validate: none('wallet.previewNext'),
    handle: () => wallet.previewNext(),
  });
  reg('wallet.deriveNext', {
    validate: fields<'wallet.deriveNext'>('wallet.deriveNext', (p) => {
      const { index, label } = p;
      if (index !== undefined && !(typeof index === 'number' && Number.isInteger(index))) {
        return null;
      }
      if (label !== undefined && typeof label !== 'string') return null;
      return {
        ...(index === undefined ? {} : { index }),
        ...(label === undefined ? {} : { label }),
      };
    }),
    handle: (r) => wallet.deriveNext(r),
  });
  reg('wallet.renameAddress', {
    validate: fields<'wallet.renameAddress'>('wallet.renameAddress', (p) =>
      typeof p.index === 'number' && Number.isInteger(p.index) && typeof p.label === 'string'
        ? { index: p.index, label: p.label }
        : null,
    ),
    handle: (r) => wallet.renameAddress(r.index, r.label),
  });
  reg('wallet.touch', {
    validate: none('wallet.touch'),
    handle: async () => {
      await wallet.rearm();
      return ok({});
    },
  });
}
