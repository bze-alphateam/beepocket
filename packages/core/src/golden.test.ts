import { describe, expect, it } from 'vitest';
import { fromB64, goldenCases, testMnemonic, toB64 } from '../test/golden';
import {
  LocalSigner,
  buildAuthInfo,
  buildBody,
  encodeMsgSend,
  signDocBytes,
  txRawBytes,
} from './index';

describe('golden transactions built by bzed', () => {
  it('has the expected cases', () => {
    expect(goldenCases.map((c) => c.name).sort()).toEqual([
      'fee-non-native',
      'send-factory-denom',
      'send-ubze',
      'send-ubze-memo',
      'two-messages',
    ]);
  });

  it.each(goldenCases)(
    '$name: body, auth info, signature and TxRaw are byte-identical',
    async (c) => {
      const bodyBytes = buildBody({
        messages: c.messages.map((m) => encodeMsgSend(m)),
        memo: c.memo,
      });
      expect(toB64(bodyBytes)).toBe(c.bodyBytes);

      const pubKey = fromB64(c.pubKey);
      const authInfoBytes = buildAuthInfo({
        pubKey,
        sequence: BigInt(c.sequence),
        fee: { amount: c.fee, gasLimit: BigInt(c.gasLimit) },
      });
      expect(toB64(authInfoBytes)).toBe(c.authInfoBytes);

      const signer = new LocalSigner(() => Promise.resolve(testMnemonic));
      expect(await signer.pubKey(c.signerIndex)).toEqual(pubKey);
      const signDoc = signDocBytes({
        bodyBytes,
        authInfoBytes,
        chainId: c.chainId,
        accountNumber: BigInt(c.accountNumber),
      });
      const signature = await signer.signDirect(c.signerIndex, signDoc);
      expect(toB64(signature)).toBe(c.signature);

      expect(toB64(txRawBytes({ bodyBytes, authInfoBytes, signatures: [signature] }))).toBe(
        c.txRaw,
      );
    },
  );
});
