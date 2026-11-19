import { describe, expect, it } from 'vitest';
import { fromB64, goldenMsgCases, testMnemonic, toB64 } from '../test/golden';
import {
  LocalSigner,
  MAINNET,
  buildAuthInfo,
  buildBody,
  encodeMsgSend,
  signDocBytes,
  txRawBytes,
  verifySignRequest,
  type AnyMsg,
} from './index';
import { VoteOption } from './proto/bze/dao/store';
import { MsgSubmitProposal, MsgVote } from './proto/bze/dao/tx';
import { MsgSetDenomConfig } from './proto/bze/tokenfactory/tx';

const SIGNER = 'bze1r5v5srda7xfth3hn2s26txvrcrntldjux0ts9g';
const OTHER = 'bze1vtad8680vhdfqvxx0f2yaxa6agdylelm92sm6p';
const FACTORY = 'factory/bze13gzq40che93tgfm9kzmkpjamah5nj0j73pyhqk/uvdl';

/** The message of each fixture, built with the wallet's own encoders. */
const MESSAGES: Record<string, AnyMsg> = {
  'dao-vote': {
    typeUrl: MsgVote.typeUrl,
    value: MsgVote.encode(
      MsgVote.fromPartial({ voter: SIGNER, proposalId: 4n, option: VoteOption.YES }),
    ).finish(),
  },
  'dao-submit-proposal': {
    typeUrl: MsgSubmitProposal.typeUrl,
    value: MsgSubmitProposal.encode(
      MsgSubmitProposal.fromPartial({
        proposer: SIGNER,
        daoId: 2n,
        title: 'Fund the meetup',
        summary: 'Pay the venue',
        msgs: [
          encodeMsgSend({
            fromAddress: OTHER,
            toAddress: SIGNER,
            amount: [{ denom: 'ubze', amount: '5000000' }],
          }),
        ],
      }),
    ).finish(),
  },
  'set-denom-config': {
    typeUrl: MsgSetDenomConfig.typeUrl,
    value: MsgSetDenomConfig.encode(
      MsgSetDenomConfig.fromPartial({
        creator: SIGNER,
        denom: FACTORY,
        communityPool: OTHER,
        transferFee: '0.01',
        gasSurcharge: '0.5',
      }),
    ).finish(),
  },
};

describe('golden BZE module messages built by bzed', () => {
  it('has the expected cases', () => {
    expect(goldenMsgCases.map((c) => c.name).sort()).toEqual(Object.keys(MESSAGES).sort());
  });

  it.each(goldenMsgCases)(
    '$name: body, auth info, signature and TxRaw are byte-identical',
    async (c) => {
      const msg = MESSAGES[c.name];
      if (!msg) throw new Error(`no message for ${c.name}`);
      const bodyBytes = buildBody({ messages: [msg], memo: c.memo });
      expect(toB64(bodyBytes)).toBe(c.bodyBytes);

      const pubKey = fromB64(c.pubKey);
      const authInfoBytes = buildAuthInfo({
        pubKey,
        sequence: BigInt(c.sequence),
        fee: { amount: c.fee, gasLimit: BigInt(c.gasLimit) },
      });
      expect(toB64(authInfoBytes)).toBe(c.authInfoBytes);

      const signer = new LocalSigner(() => Promise.resolve(testMnemonic));
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

  it.each(goldenMsgCases)('$name: the bzed sign request passes the wallet checks', (c) => {
    const result = verifySignRequest({
      network: MAINNET,
      signer: c.signer,
      connectedAddress: c.signer,
      connectedPubKey: fromB64(c.pubKey),
      signDoc: {
        bodyBytes: fromB64(c.bodyBytes),
        authInfoBytes: fromB64(c.authInfoBytes),
        chainId: c.chainId,
        accountNumber: BigInt(c.accountNumber),
      },
      chainAccount: { accountNumber: BigInt(c.accountNumber), sequence: BigInt(c.sequence) },
    });
    expect(result.ok ? 'ok' : result.code).toBe('ok');
  });
});
