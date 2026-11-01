import { describe, expect, it } from 'vitest';
import { fromB64, goldenCases } from '../test/golden';
import { TxRaw } from './proto/cosmos/tx/v1beta1/tx';
import { buildBody, decodeAuthInfo, decodeTxBody, encodeMsgSend, simulationTxBytes } from './index';

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
});

describe('buildBody', () => {
  it('defaults to an empty memo and a zero timeout height', () => {
    const body = decodeTxBody(buildBody({ messages: [] }));
    expect(body).toMatchObject({ messages: [], memo: '', timeoutHeight: '0' });
  });
});
