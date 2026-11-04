import { describe, expect, it } from 'vitest';
import { fromB64, goldenCases } from '../test/golden';
import { TxRaw } from './proto/cosmos/tx/v1beta1/tx';
import { createHash } from 'node:crypto';
import {
  txHash,
  buildBody,
  decodeTxRaw,
  decodeAuthInfo,
  decodeTxBody,
  encodeMsgSend,
  simulationTxBytes,
} from './index';

const c = goldenCases[0];
if (!c) throw new Error('no golden cases');

describe('simulationTxBytes', () => {
  it('wraps the body with an empty signature and a zero fee', () => {
    const bodyBytes = buildBody({ messages: c.messages.map((m) => encodeMsgSend(m)) });
    const raw = TxRaw.decode(simulationTxBytes(bodyBytes, fromB64(c.pubKey), 3n));
    expect(raw.bodyBytes).toEqual(bodyBytes);
    expect(raw.signatures).toEqual([new Uint8Array()]);
    expect(decodeAuthInfo(raw.authInfoBytes)).toMatchObject({
      fee: { amount: [], gasLimit: '0' },
      signerInfos: [{ sequence: '3', modeInfo: { single: { mode: 1 } } }],
    });
  });

  it('carries a fee coin with a zero gas limit when given one', () => {
    const bodyBytes = buildBody({ messages: [] });
    const raw = TxRaw.decode(
      simulationTxBytes(bodyBytes, fromB64(c.pubKey), 3n, [{ denom: 'ubze', amount: '1' }]),
    );
    expect(decodeAuthInfo(raw.authInfoBytes)).toMatchObject({
      fee: { amount: [{ denom: 'ubze', amount: '1' }], gasLimit: '0' },
    });
  });
});

describe('buildBody', () => {
  it('defaults to an empty memo and a zero timeout height', () => {
    const body = decodeTxBody(buildBody({ messages: [] }));
    expect(body).toMatchObject({ messages: [], memo: '', timeoutHeight: '0' });
  });
});

describe('txHash', () => {
  it('is the uppercase SHA-256 hex of the TxRaw bytes', () => {
    for (const g of goldenCases) {
      const raw = fromB64(g.txRaw);
      expect(txHash(raw)).toBe(createHash('sha256').update(raw).digest('hex').toUpperCase());
    }
  });
});

describe('decodeTxRaw', () => {
  it('reads the three parts of a signed transaction', () => {
    for (const g of goldenCases) {
      const decoded = decodeTxRaw(fromB64(g.txRaw));
      expect(decoded.bodyBytes).toEqual(fromB64(g.bodyBytes));
      expect(decoded.signatures).toEqual([fromB64(g.signature)]);
    }
  });

  it('throws on bytes that are not a TxRaw', () => {
    expect(() => decodeTxRaw(Uint8Array.from([0xff, 0xff, 0xff]))).toThrow();
  });
});
