import { describe, expect, it } from 'vitest';
import { fromB64, goldenCases, toB64 } from '../test/golden';
import { decodeAny, decodeAuthInfo, decodeTxBody, encodeMsgSend, knownTypeUrls } from './index';
import * as bankMsgs from './proto/cosmos/bank/v1beta1/tx';
import * as authzMsgs from './proto/cosmos/authz/v1beta1/tx';
import * as authz from './proto/cosmos/authz/v1beta1/authz';
import * as feegrantMsgs from './proto/cosmos/feegrant/v1beta1/tx';
import * as govMsgs from './proto/cosmos/gov/v1/tx';
import * as tradebinMsgs from './proto/bze/tradebin/tx';
import * as burnerMsgs from './proto/bze/burner/tx';
import { Any } from './proto/google/protobuf/any';
import { VoteOption } from './proto/cosmos/gov/v1/gov';

interface MsgCodec {
  typeUrl: string;
  encode(m: unknown): { finish(): Uint8Array };
  fromPartial(o: object): unknown;
}

const isMsg = (name: string, v: unknown): v is MsgCodec =>
  /^Msg(?!.*Response$)/.test(name) && typeof v === 'object' && v !== null && 'typeUrl' in v;

const allMsgs = [bankMsgs, authzMsgs, feegrantMsgs, govMsgs, tradebinMsgs, burnerMsgs].flatMap(
  (mod) => Object.entries(mod).filter((e): e is [string, MsgCodec] => isMsg(e[0], e[1])),
);

const send = {
  fromAddress: 'bze1r5v5srda7xfth3hn2s26txvrcrntldjux0ts9g',
  toAddress: 'bze1vtad8680vhdfqvxx0f2yaxa6agdylelm92sm6p',
  amount: [{ denom: 'ubze', amount: '1000000' }],
};

describe('decodeAny', () => {
  it('decodes a MsgSend to JSON-safe output', () => {
    expect(decodeAny(encodeMsgSend(send))).toEqual({
      typeUrl: '/cosmos.bank.v1beta1.MsgSend',
      value: send,
    });
  });

  it('turns bigint into strings and bytes into base64', () => {
    const msg = authzMsgs.MsgGrant.fromPartial({
      granter: send.fromAddress,
      grantee: send.toAddress,
      grant: {
        authorization: Any.fromPartial({
          typeUrl: '/cosmos.authz.v1beta1.GenericAuthorization',
          value: authz.GenericAuthorization.encode(
            authz.GenericAuthorization.fromPartial({ msg: '/cosmos.bank.v1beta1.MsgSend' }),
          ).finish(),
        }),
      },
    });
    const decoded = decodeAny({
      typeUrl: authzMsgs.MsgGrant.typeUrl,
      value: authzMsgs.MsgGrant.encode(msg).finish(),
    });
    expect(JSON.parse(JSON.stringify(decoded))).toEqual(decoded);
    expect(decoded).toMatchObject({
      value: {
        grant: {
          authorization: {
            typeUrl: '/cosmos.authz.v1beta1.GenericAuthorization',
            value: { msg: '/cosmos.bank.v1beta1.MsgSend' },
          },
        },
      },
    });
  });

  it('decodes messages nested in MsgExec', () => {
    const exec = authzMsgs.MsgExec.fromPartial({
      grantee: send.toAddress,
      msgs: [Any.fromPartial(encodeMsgSend(send))],
    });
    const decoded = decodeAny({
      typeUrl: authzMsgs.MsgExec.typeUrl,
      value: authzMsgs.MsgExec.encode(exec).finish(),
    });
    expect(decoded).toEqual({
      typeUrl: authzMsgs.MsgExec.typeUrl,
      value: {
        grantee: send.toAddress,
        msgs: [{ typeUrl: '/cosmos.bank.v1beta1.MsgSend', value: send }],
      },
    });
  });

  it('decodes a gov v1 MsgVote', () => {
    const vote = govMsgs.MsgVote.fromPartial({
      proposalId: 12n,
      voter: send.fromAddress,
      option: VoteOption.VOTE_OPTION_NO_WITH_VETO,
    });
    expect(
      decodeAny({ typeUrl: govMsgs.MsgVote.typeUrl, value: govMsgs.MsgVote.encode(vote).finish() }),
    ).toEqual({
      typeUrl: '/cosmos.gov.v1.MsgVote',
      value: { proposalId: '12', voter: send.fromAddress, option: 4, metadata: '' },
    });
  });

  it('marks an unknown type URL as unknown', () => {
    expect(decodeAny({ typeUrl: '/foo.bar.MsgNope', value: new Uint8Array([1, 2]) })).toEqual({
      typeUrl: '/foo.bar.MsgNope',
      unknown: true,
    });
  });

  it('knows every copied Msg type and decodes an encoded sample of each', () => {
    expect(allMsgs.length).toBeGreaterThan(25);
    const known = knownTypeUrls();
    for (const [name, codec] of allMsgs) {
      expect(known, name).toContain(codec.typeUrl);
      const decoded = decodeAny({
        typeUrl: codec.typeUrl,
        value: codec.encode(codec.fromPartial({})).finish(),
      });
      expect('unknown' in decoded, name).toBe(false);
      expect(JSON.parse(JSON.stringify(decoded)), name).toEqual(decoded);
    }
  });
});

describe('decodeTxBody and decodeAuthInfo', () => {
  it.each(goldenCases)('$name: round-trips the bzed transaction', (c) => {
    const body = decodeTxBody(fromB64(c.bodyBytes));
    expect(body).toMatchObject({ memo: c.memo, timeoutHeight: '0' });
    expect(body.messages).toEqual(
      c.messages.map((m) => ({
        typeUrl: m.typeUrl,
        value: { fromAddress: m.fromAddress, toAddress: m.toAddress, amount: m.amount },
      })),
    );

    const authInfo = decodeAuthInfo(fromB64(c.authInfoBytes));
    expect(authInfo).toMatchObject({
      fee: { amount: c.fee, gasLimit: c.gasLimit, payer: '', granter: '' },
      signerInfos: [
        {
          publicKey: { typeUrl: '/cosmos.crypto.secp256k1.PubKey', value: { key: c.pubKey } },
          modeInfo: { single: { mode: 1 } },
          sequence: c.sequence,
        },
      ],
    });
  });

  it('keeps the golden pubkey encoding stable', () => {
    expect(toB64(fromB64(goldenCases[0]?.pubKey ?? ''))).toBe(goldenCases[0]?.pubKey);
  });
});
