import { describe, expect, it } from 'vitest';
import { MAINNET, NETWORKS, TESTNET } from '../index';

describe('networks', () => {
  it('lists the fixed v1 endpoints', () => {
    expect(NETWORKS.mainnet).toBe(MAINNET);
    expect(NETWORKS.testnet).toBe(TESTNET);
    expect(MAINNET).toEqual({
      id: 'mainnet',
      chainId: 'beezee-1',
      rest: 'https://rest.getbze.com',
      rpc: 'https://rpc.getbze.com',
      scan: 'https://explorer.getbze.com',
    });
    expect(TESTNET).toEqual({
      id: 'testnet',
      chainId: 'bzetestnet-3',
      rest: 'https://testnet.getbze.com',
      rpc: 'https://testnet-rpc.getbze.com',
      scan: 'https://testnet-explorer.getbze.com',
    });
  });
});
