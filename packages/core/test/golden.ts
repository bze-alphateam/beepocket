import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { base64 } from '@scure/base';

export interface GoldenCase {
  name: string;
  signerIndex: number;
  signer: string;
  pubKey: string;
  chainId: string;
  accountNumber: string;
  sequence: string;
  gasLimit: string;
  fee: { denom: string; amount: string }[];
  memo: string;
  messages: {
    typeUrl: string;
    fromAddress: string;
    toAddress: string;
    amount: { denom: string; amount: string }[];
  }[];
  bodyBytes: string;
  authInfoBytes: string;
  signature: string;
  txRaw: string;
}

const dir = join(import.meta.dirname, 'fixtures', 'golden');

/** The transactions built and signed by the real `bzed` (see scripts/gen-golden.sh). */
export const goldenCases: GoldenCase[] = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as GoldenCase);

export const fromB64 = (s: string): Uint8Array => base64.decode(s);
export const toB64 = (b: Uint8Array): string => base64.encode(b);
export const testMnemonic = `${'abandon '.repeat(23)}art`;
