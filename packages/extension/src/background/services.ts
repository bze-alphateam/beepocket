import {
  HttpScanClient,
  NETWORKS,
  RestChainClient,
  type ChainClient,
  type Network,
  type NetworkId,
  type ScanClient,
} from '@beepocket/core';
import type { Platform } from '../platform';

export const NETWORK_KEY = 'network';
export const DEFAULT_NETWORK: NetworkId = 'mainnet';

export interface NetworkClients {
  network: Network;
  chain: ChainClient;
  scan: ScanClient;
}

/**
 * Core clients for the active network. The worker is stateless: the network id is read from
 * storage on every call and the (cheap) clients are rebuilt, so nothing lives in module state.
 */
export interface Services {
  activeNetwork(): Promise<Network>;
  /** Clients for the active network, or for a given one. */
  clients(network?: NetworkId): Promise<NetworkClients>;
}

export function createServices(platform: Platform): Services {
  const activeNetwork = async (): Promise<Network> => {
    const stored = await platform.storage.get(NETWORK_KEY);
    return typeof stored === 'string' && Object.hasOwn(NETWORKS, stored)
      ? NETWORKS[stored as NetworkId]
      : NETWORKS[DEFAULT_NETWORK];
  };
  return {
    activeNetwork,
    async clients(id) {
      const network = id === undefined ? await activeNetwork() : NETWORKS[id];
      return {
        network,
        chain: new RestChainClient(platform.transport, network),
        scan: new HttpScanClient(platform.transport, network),
      };
    },
  };
}
