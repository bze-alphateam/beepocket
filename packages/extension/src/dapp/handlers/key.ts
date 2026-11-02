import { NETWORKS } from '@beepocket/core';
import { ErrorCodes, fail, ok, WalletErrorCodes, type Result } from '../../protocol';
import type { Services } from '../../background/services';
import type { WalletService } from '../../features/wallet';
import type { Profile, ProfileAddress } from '../../features/wallet/profile';
import type { Decision, DappHandler, UserAnswer } from '../registry';
import { answer, refuse, type Outcome, type PendingRequest } from '../types';
import { bytesToWire, DappErrorCodes, type WireKey } from '../wire';

export interface KeyDeps {
  wallet: WalletService;
  services: Services;
  clock: { now(): number };
}

export interface KeyParams {
  chainId: string;
}

const MAX_CHAIN_ID = 64;

export function validateKeyParams(params: unknown): Result<KeyParams> {
  if (
    typeof params === 'object' &&
    params !== null &&
    'chainId' in params &&
    typeof params.chainId === 'string' &&
    params.chainId.length > 0 &&
    params.chainId.length <= MAX_CHAIN_ID
  ) {
    return ok({ chainId: params.chainId });
  }
  return fail(ErrorCodes.badRequest, 'chainId must be a string.');
}

/** Business Logic §1: the wallet works on one network at a time. */
export function networkRefusal(
  request: PendingRequest,
  params: KeyParams,
  activeId: string,
): Outcome | null {
  const active = NETWORKS[activeId as keyof typeof NETWORKS];
  if (activeId === request.network && params.chainId === active.chainId) return null;
  const name = active.id === 'mainnet' ? 'Mainnet' : 'Testnet';
  return refuse(DappErrorCodes.wrongChain, `BeePocket is on ${name}`);
}

/** The public key of an address, from the profile or (when unlocked) derived; null when neither. */
export async function pubKeyOf(
  deps: KeyDeps,
  entry: ProfileAddress,
  unlocked: boolean,
): Promise<string | null> {
  if (entry.pubKey !== undefined) return entry.pubKey;
  if (!unlocked) return null;
  const derived = await deps.wallet.pubKey(entry.address);
  return derived.ok ? bytesToWire(derived.value) : null;
}

function wireKey(entry: ProfileAddress, pubKey: string): WireKey {
  return {
    address: entry.address,
    bech32Address: entry.address,
    pubKey,
    name: entry.label,
    algo: 'secp256k1',
    isNanoLedger: false,
  };
}

export function connectedAddress(profile: Profile, request: PendingRequest): ProfileAddress | undefined {
  const site = Object.hasOwn(profile.sites[request.network], request.origin)
    ? profile.sites[request.network][request.origin]
    : undefined;
  return site && profile.addresses.find((a) => a.address === site.address);
}

/**
 * `connect` and `getKey` differ only in what an unconnected site gets: `getKey` is refused,
 * `connect` asks the user.
 */
export function keyHandler(deps: KeyDeps, mode: 'connect' | 'getKey'): DappHandler<KeyParams> {
  return {
    validate: validateKeyParams,

    async decide(request) {
      const active = await deps.services.activeNetwork();
      const wrong = networkRefusal(request, request.params, active.id);
      if (wrong) return { kind: 'answer', outcome: wrong };
      const { state } = await deps.wallet.state();
      if (state === 'uninitialised') {
        return {
          kind: 'answer',
          outcome: refuse(DappErrorCodes.notConnected, 'BeePocket has no wallet yet.'),
        };
      }
      const profile = state === 'locked' ? null : await deps.wallet.getProfile();
      if (!profile?.ok) return { kind: 'locked' };
      const entry = connectedAddress(profile.value, request);
      if (entry) {
        const pubKey = await pubKeyOf(deps, entry, state === 'unlocked');
        return pubKey === null
          ? { kind: 'unlock' }
          : { kind: 'answer', outcome: answer(wireKey(entry, pubKey)) };
      }
      if (mode === 'getKey') {
        return {
          kind: 'answer',
          outcome: refuse(DappErrorCodes.notConnected, 'This site is not connected.'),
        };
      }
      return { kind: 'connect', addresses: profile.value.addresses.map(listed) } satisfies Decision;
    },

    async confirm(request, user: UserAnswer) {
      if (!user.approve) return ok(refuse(DappErrorCodes.rejected, 'The request was rejected.'));
      const active = await deps.services.activeNetwork();
      const wrong = networkRefusal(request, request.params, active.id);
      if (wrong) return ok(wrong);
      const profile = await deps.wallet.getProfile();
      if (!profile.ok) return profile;
      const entry = profile.value.addresses.find((a) => a.index === user.index);
      if (!entry) return fail(WalletErrorCodes.unknownAddress, 'No such address.');
      // Saving the site re-seals the profile, which needs the key: weak lock answers needs-password.
      const saved = await deps.wallet.updateProfile((p) => {
        p.sites[request.network][request.origin] = {
          address: entry.address,
          connectedAt: deps.clock.now(),
        };
        return p;
      });
      if (!saved.ok) return saved;
      const pubKey = await pubKeyOf(deps, entry, true);
      if (pubKey === null) return fail(ErrorCodes.internal, 'The public key is not available.');
      return ok(answer(wireKey(entry, pubKey)));
    },
  };
}

function listed(a: ProfileAddress) {
  return { index: a.index, label: a.label, address: a.address };
}
