import { describe, expect, it } from 'vitest';
import {
  buildAuthInfo,
  buildBody,
  decodeAuthInfo,
  encodeMsgSend,
  MAINNET,
  TESTNET,
  verifySignRequest,
  withWalletFee,
  type AnyMsg,
  type VerifyInput,
} from './index';
import { MsgExec } from './proto/cosmos/authz/v1beta1/tx';
import { VoteOption } from './proto/cosmos/gov/v1/gov';
import { MsgVote } from './proto/cosmos/gov/v1/tx';
import { MsgMultiSend } from './proto/cosmos/bank/v1beta1/tx';
import { PubKey } from './proto/cosmos/crypto/secp256k1/keys';
import { SignMode } from './proto/cosmos/tx/signing/v1beta1/signing';
import { AuthInfo, Fee, TxBody } from './proto/cosmos/tx/v1beta1/tx';
import { Any } from './proto/google/protobuf/any';
import { MsgCreateOrder } from './proto/bze/tradebin/tx';

const ME = 'bze1r5v5srda7xfth3hn2s26txvrcrntldjux0ts9g';
const OTHER = 'bze1vtad8680vhdfqvxx0f2yaxa6agdylelm92sm6p';
const PUB = new Uint8Array(33).fill(2);
const fee = { amount: [{ denom: 'ubze', amount: '5000' }], gasLimit: 200_000n };

const send = (from = ME): AnyMsg =>
  encodeMsgSend({ fromAddress: from, toAddress: OTHER, amount: [{ denom: 'ubze', amount: '1' }] });

function request(overrides: Partial<VerifyInput> = {}, messages: AnyMsg[] = [send()]): VerifyInput {
  return {
    network: MAINNET,
    signer: ME,
    connectedAddress: ME,
    connectedPubKey: PUB,
    signDoc: {
      bodyBytes: buildBody({ messages }),
      authInfoBytes: buildAuthInfo({ pubKey: PUB, sequence: 5n, fee }),
      chainId: MAINNET.chainId,
      accountNumber: 77n,
    },
    chainAccount: { accountNumber: 77n, sequence: 5n },
    ...overrides,
  };
}

const withAuthInfo = (auth: AuthInfo) =>
  request({
    signDoc: { ...request().signDoc, authInfoBytes: AuthInfo.encode(auth).finish() },
  });

const signerInfo = (extra: object = {}) => ({
  publicKey: Any.fromPartial({
    typeUrl: '/cosmos.crypto.secp256k1.PubKey',
    value: PubKey.encode(PubKey.fromPartial({ key: PUB })).finish(),
  }),
  modeInfo: { single: { mode: SignMode.SIGN_MODE_DIRECT } },
  sequence: 5n,
  ...extra,
});

const code = (input: VerifyInput) => {
  const result = verifySignRequest(input);
  return result.ok ? 'ok' : result.code;
};

describe('verifySignRequest', () => {
  it('accepts a plain request and returns the decoded parts', () => {
    const result = verifySignRequest(request());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.messages).toEqual([send()]);
    expect(result.body.messages).toHaveLength(1);
    expect(result.authInfo.signerInfos[0]?.sequence).toBe(5n);
  });

  it('accepts a brand-new account (unknown to the chain) at sequence 0', () => {
    const fresh = request({ chainAccount: null });
    const signDoc = {
      ...fresh.signDoc,
      authInfoBytes: buildAuthInfo({ pubKey: PUB, sequence: 0n, fee }),
    };
    expect(code({ ...fresh, signDoc })).toBe('ok');
  });

  it('accepts a request that carries no public key', () => {
    const auth = AuthInfo.fromPartial({
      signerInfos: [signerInfo({ publicKey: undefined })],
      fee: Fee.fromPartial(fee),
    });
    expect(code(withAuthInfo(auth))).toBe('ok');
  });

  it('wrong-chain: another chain id, including the other network', () => {
    const base = request();
    expect(code({ ...base, signDoc: { ...base.signDoc, chainId: TESTNET.chainId } })).toBe(
      'wrong-chain',
    );
    expect(code({ ...base, network: TESTNET })).toBe('wrong-chain');
  });

  it('not-connected-signer: the dapp names another address', () => {
    expect(code(request({ signer: OTHER }))).toBe('not-connected-signer');
  });

  it('bad-body: garbage, empty, oversized, too many messages, extension options', () => {
    const doc = request().signDoc;
    const body = (bodyBytes: Uint8Array) => request({ signDoc: { ...doc, bodyBytes } });
    expect(code(body(new Uint8Array([0xff, 0xff, 0xff])))).toBe('bad-body');
    expect(code(body(buildBody({ messages: [] })))).toBe('bad-body');
    expect(code(body(new Uint8Array(300_000)))).toBe('bad-body');
    expect(code(body(buildBody({ messages: Array.from({ length: 65 }, () => send()) })))).toBe(
      'bad-body',
    );
    const ext = TxBody.encode(
      TxBody.fromPartial({
        messages: [Any.fromPartial(send())],
        extensionOptions: [Any.fromPartial({ typeUrl: '/x.Ext', value: new Uint8Array() })],
      }),
    ).finish();
    expect(code(body(ext))).toBe('bad-body');
  });

  it('bad-body: a known message type whose bytes do not decode', () => {
    const broken: AnyMsg = {
      typeUrl: '/cosmos.bank.v1beta1.MsgSend',
      value: new Uint8Array([10, 99]),
    };
    expect(code(request({}, [broken]))).toBe('bad-body');
  });

  it('bad-auth-info: garbage or oversized', () => {
    const doc = request().signDoc;
    const auth = (authInfoBytes: Uint8Array) => request({ signDoc: { ...doc, authInfoBytes } });
    expect(code(auth(new Uint8Array([0xff, 0xff])))).toBe('bad-auth-info');
    expect(code(auth(new Uint8Array(9000)))).toBe('bad-auth-info');
  });

  it('multi-signer: two signer infos, or none', () => {
    const two = AuthInfo.fromPartial({
      signerInfos: [signerInfo(), signerInfo()],
      fee: Fee.fromPartial(fee),
    });
    expect(code(withAuthInfo(two))).toBe('multi-signer');
    const none = AuthInfo.fromPartial({ signerInfos: [], fee: Fee.fromPartial(fee) });
    expect(code(withAuthInfo(none))).toBe('multi-signer');
  });

  it('multi-signer: any message signed by someone else', () => {
    expect(code(request({}, [send(OTHER)]))).toBe('multi-signer');
    expect(code(request({}, [send(), send(OTHER)]))).toBe('multi-signer');
  });

  it('multi-signer: checks the signer field of each message type', () => {
    const order = (creator: string): AnyMsg => ({
      typeUrl: MsgCreateOrder.typeUrl,
      value: MsgCreateOrder.encode(
        MsgCreateOrder.fromPartial({
          creator,
          orderType: 'buy',
          amount: '1',
          price: '1',
          marketId: 'm',
        }),
      ).finish(),
    });
    const vote = (voter: string): AnyMsg => ({
      typeUrl: MsgVote.typeUrl,
      value: MsgVote.encode(
        MsgVote.fromPartial({ voter, proposalId: 1n, option: VoteOption.VOTE_OPTION_YES }),
      ).finish(),
    });
    const exec = (grantee: string): AnyMsg => ({
      typeUrl: MsgExec.typeUrl,
      value: MsgExec.encode(MsgExec.fromPartial({ grantee, msgs: [] })).finish(),
    });
    const multi = (address: string): AnyMsg => ({
      typeUrl: MsgMultiSend.typeUrl,
      value: MsgMultiSend.encode(
        MsgMultiSend.fromPartial({
          inputs: [{ address, coins: [{ denom: 'ubze', amount: '1' }] }],
          outputs: [{ address: OTHER, coins: [{ denom: 'ubze', amount: '1' }] }],
        }),
      ).finish(),
    });
    for (const make of [order, vote, exec, multi]) {
      expect(code(request({}, [make(ME)]))).toBe('ok');
      expect(code(request({}, [make(OTHER)]))).toBe('multi-signer');
    }
  });

  it('multi-signer: an empty signer field is not the connected address', () => {
    expect(code(request({}, [send('')]))).toBe('multi-signer');
  });

  it('lets a message type the wallet cannot decode through (the chain checks its signer)', () => {
    const unknown: AnyMsg = {
      typeUrl: '/cosmos.slashing.v1beta1.MsgUnjail',
      value: new Uint8Array([1]),
    };
    expect(code(request({}, [unknown]))).toBe('ok');
  });

  it('pubkey-mismatch: another key, a wrong key type, an unreadable key', () => {
    const key = (typeUrl: string, value: Uint8Array) =>
      AuthInfo.fromPartial({
        signerInfos: [signerInfo({ publicKey: Any.fromPartial({ typeUrl, value }) })],
        fee: Fee.fromPartial(fee),
      });
    const secp = '/cosmos.crypto.secp256k1.PubKey';
    const other = PubKey.encode(PubKey.fromPartial({ key: new Uint8Array(33).fill(9) })).finish();
    expect(code(withAuthInfo(key(secp, other)))).toBe('pubkey-mismatch');
    expect(code(withAuthInfo(key('/cosmos.crypto.ed25519.PubKey', other)))).toBe('pubkey-mismatch');
    expect(code(withAuthInfo(key(secp, new Uint8Array([0xff]))))).toBe('pubkey-mismatch');
    expect(code(request({ connectedPubKey: new Uint8Array(33).fill(3) }))).toBe('pubkey-mismatch');
  });

  it('sign-mode: anything but SIGN_MODE_DIRECT', () => {
    for (const modeInfo of [
      { single: { mode: SignMode.SIGN_MODE_LEGACY_AMINO_JSON } },
      { single: { mode: SignMode.SIGN_MODE_UNSPECIFIED } },
      undefined,
    ]) {
      const auth = AuthInfo.fromPartial({
        signerInfos: [signerInfo({ modeInfo })],
        fee: Fee.fromPartial(fee),
      });
      expect(code(withAuthInfo(auth))).toBe('sign-mode');
    }
  });

  it('account-number: differs from the chain, even when the dapp says 0', () => {
    const base = request();
    expect(code({ ...base, chainAccount: { accountNumber: 78n, sequence: 5n } })).toBe(
      'account-number',
    );
    expect(code({ ...base, signDoc: { ...base.signDoc, accountNumber: 0n } })).toBe(
      'account-number',
    );
  });

  it('fee-granter: a granter or a payer', () => {
    for (const extra of [{ granter: OTHER }, { payer: OTHER }, { payer: ME }]) {
      const auth = AuthInfo.fromPartial({
        signerInfos: [signerInfo()],
        fee: Fee.fromPartial({ ...fee, ...extra }),
      });
      expect(code(withAuthInfo(auth))).toBe('fee-granter');
    }
  });

  it('reports the first failing check', () => {
    const base = request({ signer: OTHER, chainAccount: { accountNumber: 1n, sequence: 0n } });
    expect(code({ ...base, signDoc: { ...base.signDoc, chainId: 'x' } })).toBe('wrong-chain');
    expect(code(base)).toBe('not-connected-signer');
    const badAuth = {
      ...base,
      signer: ME,
      signDoc: {
        ...base.signDoc,
        bodyBytes: new Uint8Array([0xff]),
        authInfoBytes: new Uint8Array([0xff]),
      },
    };
    expect(code(badAuth)).toBe('bad-body');
  });
});

describe('verifySignRequest sequence and timeout', () => {
  const at = (sequence: bigint, chainAccount: VerifyInput['chainAccount']) =>
    request({
      chainAccount,
      signDoc: {
        ...request().signDoc,
        authInfoBytes: buildAuthInfo({ pubKey: PUB, sequence, fee }),
      },
    });

  it('sequence: differs from the account, in either direction', () => {
    const account = { accountNumber: 77n, sequence: 5n };
    expect(code(at(5n, account))).toBe('ok');
    expect(code(at(4n, account))).toBe('sequence');
    expect(code(at(6n, account))).toBe('sequence');
  });

  it('sequence: an account the chain has not seen must be at 0', () => {
    expect(code(at(0n, null))).toBe('ok');
    expect(code(at(1n, null))).toBe('sequence');
  });

  it('allows a timeout height: it can only shorten the validity', () => {
    const body = TxBody.encode(
      TxBody.fromPartial({ messages: [Any.fromPartial(send())], timeoutHeight: 123_456n }),
    ).finish();
    const base = request();
    expect(code({ ...base, signDoc: { ...base.signDoc, bodyBytes: body } })).toBe('ok');
  });
});

/** A protobuf message whose only field `no` is the text. */
function stringMsg(typeUrl: string, no: number, text: string): AnyMsg {
  const bytes = new TextEncoder().encode(text);
  return { typeUrl, value: new Uint8Array([(no << 3) | 2, bytes.length, ...bytes]) };
}

describe('verifySignRequest signers of types without a decoder', () => {
  const cases: [string, number][] = [
    ['/ibc.applications.transfer.v1.MsgTransfer', 4],
    ['/cosmos.staking.v1beta1.MsgDelegate', 1],
    ['/cosmos.staking.v1beta1.MsgUndelegate', 1],
    ['/cosmos.staking.v1beta1.MsgBeginRedelegate', 1],
    ['/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward', 1],
  ];

  it.each(cases)(
    '%s: the signer field is the connected address or the request is refused',
    (url, no) => {
      expect(code(request({}, [stringMsg(url, no, ME)]))).toBe('ok');
      expect(code(request({}, [stringMsg(url, no, OTHER)]))).toBe('multi-signer');
      // The signer field is missing altogether.
      expect(code(request({}, [stringMsg(url, no + 1, ME)]))).toBe('multi-signer');
    },
  );

  it('bad-body: the signer field cannot be read', () => {
    const broken: AnyMsg = {
      typeUrl: '/cosmos.staking.v1beta1.MsgDelegate',
      value: new Uint8Array([10, 99]),
    };
    expect(code(request({}, [broken]))).toBe('bad-body');
  });

  it('finds the field after other fields', () => {
    const value = new Uint8Array([
      ...stringMsg('x', 1, 'a').value,
      ...stringMsg('x', 4, OTHER).value,
    ]);
    const msg: AnyMsg = { typeUrl: '/ibc.applications.transfer.v1.MsgTransfer', value };
    expect(code(request({}, [msg]))).toBe('multi-signer');
  });
});

describe('withWalletFee', () => {
  const walletFee = { amount: [{ denom: 'ubze', amount: '777' }], gasLimit: 999n };

  it('replaces only the fee: sequence, key and mode stay', () => {
    const original = buildAuthInfo({ pubKey: PUB, sequence: 5n, fee });
    const rebuilt = withWalletFee(original, walletFee);
    const before = decodeAuthInfo(original);
    const after = decodeAuthInfo(rebuilt);
    expect(after.signerInfos).toEqual(before.signerInfos);
    expect(after.fee).toEqual({
      amount: walletFee.amount,
      gasLimit: '999',
      payer: '',
      granter: '',
    });
  });

  it('drops a payer and a granter the request carried', () => {
    const auth = AuthInfo.encode(
      AuthInfo.fromPartial({
        signerInfos: [signerInfo()],
        fee: Fee.fromPartial({ ...fee, payer: OTHER, granter: OTHER }),
      }),
    ).finish();
    const decoded = AuthInfo.decode(withWalletFee(auth, walletFee));
    expect(decoded.fee?.payer).toBe('');
    expect(decoded.fee?.granter).toBe('');
  });

  it('fills in the public key only when the request has none', () => {
    const bare = AuthInfo.encode(
      AuthInfo.fromPartial({
        signerInfos: [signerInfo({ publicKey: undefined })],
        fee: Fee.fromPartial(fee),
      }),
    ).finish();
    const filled = AuthInfo.decode(withWalletFee(bare, walletFee, PUB));
    expect(PubKey.decode(filled.signerInfos[0]?.publicKey?.value ?? new Uint8Array()).key).toEqual(
      PUB,
    );
    expect(
      AuthInfo.decode(withWalletFee(bare, walletFee)).signerInfos[0]?.publicKey,
    ).toBeUndefined();

    const other = new Uint8Array(33).fill(8);
    const keep = AuthInfo.decode(
      withWalletFee(buildAuthInfo({ pubKey: PUB, sequence: 1n, fee }), walletFee, other),
    );
    expect(PubKey.decode(keep.signerInfos[0]?.publicKey?.value ?? new Uint8Array()).key).toEqual(
      PUB,
    );
  });

  it('refuses anything but one signer', () => {
    const two = AuthInfo.encode(
      AuthInfo.fromPartial({
        signerInfos: [signerInfo(), signerInfo()],
        fee: Fee.fromPartial(fee),
      }),
    ).finish();
    expect(() => withWalletFee(two, walletFee)).toThrow(RangeError);
  });
});
