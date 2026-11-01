export type NetworkId = 'mainnet' | 'testnet';

export interface Network {
  readonly id: NetworkId;
  readonly chainId: string;
  /** REST (LCD) base URL of a BZE node, no trailing slash. */
  readonly rest: string;
  readonly rpc: string;
  /** BZE Scan base URL, no trailing slash. */
  readonly scan: string;
}

export const MAINNET: Network = {
  id: 'mainnet',
  chainId: 'beezee-1',
  rest: 'https://rest.getbze.com',
  rpc: 'https://rpc.getbze.com',
  scan: 'https://explorer.getbze.com',
};

export const TESTNET: Network = {
  id: 'testnet',
  chainId: 'bzetestnet-3',
  rest: 'https://testnet.getbze.com',
  rpc: 'https://testnet-rpc.getbze.com',
  scan: 'https://testnet-explorer.getbze.com',
};

export const NETWORKS: Readonly<Record<NetworkId, Network>> = {
  mainnet: MAINNET,
  testnet: TESTNET,
};
