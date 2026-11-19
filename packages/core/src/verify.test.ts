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
import { MsgMultiSend, MsgSend } from './proto/cosmos/bank/v1beta1/tx';
import { PubKey } from './proto/cosmos/crypto/secp256k1/keys';
import { SignMode } from './proto/cosmos/tx/signing/v1beta1/signing';
import { AuthInfo, Fee, TxBody } from './proto/cosmos/tx/v1beta1/tx';
import { Any } from './proto/google/protobuf/any';
import {
  MsgAddLiquidity,
  MsgCreateLiquidityPool,
  MsgCreateOrder,
  MsgFillOrders,
  MsgMultiSwap,
  MsgRemoveLiquidity,
} from './proto/bze/tradebin/tx';
import { Coin } from './proto/cosmos/base/v1beta1/coin';
import { BasicAllowance, PeriodicAllowance } from './proto/cosmos/feegrant/v1beta1/feegrant';
import { MsgGrantAllowance } from './proto/cosmos/feegrant/v1beta1/tx';
import { MsgTransfer } from './proto/ibc/applications/transfer/v1/tx';
import * as bankMsgs from './proto/cosmos/bank/v1beta1/tx';
import * as authzMsgs from './proto/cosmos/authz/v1beta1/tx';
import * as feegrantMsgs from './proto/cosmos/feegrant/v1beta1/tx';
import * as govMsgs from './proto/cosmos/gov/v1/tx';
import * as tradebinMsgs from './proto/bze/tradebin/tx';
import * as burnerMsgs from './proto/bze/burner/tx';
import * as rewardsMsgs from './proto/bze/rewards/tx';
import * as tokenfactoryMsgs from './proto/bze/tokenfactory/tx';
import * as cointrunkMsgs from './proto/bze/cointrunk/tx';
import * as daoMsgs from './proto/bze/dao/tx';
import { VoteOption as DaoVoteOption } from './proto/bze/dao/store';
import * as guardianMsgs from './proto/bze/guardian/v1/tx';
import * as stakingMsgs from './proto/cosmos/staking/v1beta1/tx';
import * as distributionMsgs from './proto/cosmos/distribution/v1beta1/tx';
import * as transferMsgs from './proto/ibc/applications/transfer/v1/tx';
import * as vestingMsgs from './proto/cosmos/vesting/v1beta1/tx';
import { fromB64, goldenCases } from '../test/golden';

interface MsgCodec {
  typeUrl: string;
  encode(m: unknown): { finish(): Uint8Array };
  fromPartial(o: object): unknown;
}
const isMsg = (name: string, v: unknown): v is MsgCodec =>
  /^Msg(?!.*Response$)/.test(name) && typeof v === 'object' && v !== null && 'typeUrl' in v;
/** Every message type the wallet has an encoder for. */
const allMsgs = [
  bankMsgs,
  authzMsgs,
  feegrantMsgs,
  govMsgs,
  tradebinMsgs,
  burnerMsgs,
  rewardsMsgs,
  tokenfactoryMsgs,
  cointrunkMsgs,
  daoMsgs,
  guardianMsgs,
  stakingMsgs,
  distributionMsgs,
  transferMsgs,
  vestingMsgs,
].flatMap((mod) => Object.entries(mod).filter((e): e is [string, MsgCodec] => isMsg(e[0], e[1])));

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

  it.each([
    '/bze.txfeecollector.MsgUpdateParams',
    '/bze.tradebin.MsgUpdateParams',
    '/bze.tradebin.MsgHaltDenoms',
    '/bze.cointrunk.MsgSavePublisher',
    '/bze.tokenfactory.MsgSetDenomAdmin',
    '/bze.tradebin.MsgUpdatePools',
    '/bze.dao.MsgUpdateParams',
    '/bze.guardian.v1.MsgUpdateParams',
    '/bze.guardian.v1.MsgUnblockDenom',
    '/bze.guardian.v1.MsgResumeAutomation',
    '/bze.guardian.v1.MsgReopenChannel',
    '/ratelimit.v1.MsgAddRateLimit',
    '/ratelimit.v1.MsgUpdateRateLimit',
    '/ratelimit.v1.MsgRemoveRateLimit',
    '/ratelimit.v1.MsgResetRateLimit',
  ])('multi-signer: %s is signed by governance only, never by the wallet', (typeUrl) => {
    // Some of these have no decoder, so their signer would otherwise go unchecked.
    expect(code(request({}, [{ typeUrl, value: new Uint8Array([10, 1, 65]) }]))).toBe(
      'multi-signer',
    );
    expect(code(request({}, [send(), { typeUrl, value: new Uint8Array() }]))).toBe('multi-signer');
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

describe('verifySignRequest signers of decoded types', () => {
  it.each([
    ['/bze.cointrunk.MsgAddArticle', 1],
    ['/ibc.applications.transfer.v1.MsgUpdateParams', 1],
    ['/cosmos.staking.v1beta1.MsgCancelUnbondingDelegation', 1],
    ['/cosmos.distribution.v1beta1.MsgSetWithdrawAddress', 1],
  ])('%s: the signer field is the connected address or the request is refused', (url, no) => {
    expect(code(request({}, [stringMsg(url, no, ME)]))).toBe('ok');
    expect(code(request({}, [stringMsg(url, no, OTHER)]))).toBe('multi-signer');
  });

  it('does not take the new rewards address for a signer', () => {
    const value = new Uint8Array([
      ...stringMsg('x', 1, ME).value,
      ...stringMsg('x', 2, OTHER).value,
    ]);
    const msg: AnyMsg = { typeUrl: '/cosmos.distribution.v1beta1.MsgSetWithdrawAddress', value };
    expect(code(request({}, [msg]))).toBe('ok');
  });
});

describe('verifySignRequest signers of DAO, guardian and token config messages', () => {
  const msg = <P, M>(
    codec: { typeUrl: string; fromPartial(p: P): M; encode(m: M): { finish(): Uint8Array } },
    partial: P,
  ): AnyMsg => ({
    typeUrl: codec.typeUrl,
    value: codec.encode(codec.fromPartial(partial)).finish(),
  });
  // Each case puts OTHER in the fields that name an address but do not sign.
  const cases: [string, (signer: string) => AnyMsg][] = [
    ['MsgAdminExecute', (s) => msg(daoMsgs.MsgAdminExecute, { admin: s, daoId: 1n })],
    [
      'MsgAcceptAdminNomination',
      (s) => msg(daoMsgs.MsgAcceptAdminNomination, { nominee: s, daoId: 1n }),
    ],
    ['MsgCreateDao', (s) => msg(daoMsgs.MsgCreateDao, { creator: s, admin: OTHER, name: 'd' })],
    [
      'MsgNominateAdmin',
      (s) => msg(daoMsgs.MsgNominateAdmin, { authority: s, daoId: 1n, nominee: OTHER }),
    ],
    [
      'MsgWithdrawAdminNomination',
      (s) => msg(daoMsgs.MsgWithdrawAdminNomination, { authority: s, daoId: 1n }),
    ],
    ['MsgSubmitProposal', (s) => msg(daoMsgs.MsgSubmitProposal, { proposer: s, daoId: 1n })],
    [
      'dao MsgVote',
      (s) => msg(daoMsgs.MsgVote, { voter: s, proposalId: 1n, option: DaoVoteOption.YES }),
    ],
    ['MsgCancelProposal', (s) => msg(daoMsgs.MsgCancelProposal, { proposer: s, proposalId: 1n })],
    ['MsgSettleProposal', (s) => msg(daoMsgs.MsgSettleProposal, { sender: s, proposalId: 1n })],
    ['MsgCleanupProposal', (s) => msg(daoMsgs.MsgCleanupProposal, { sender: s, proposalId: 1n })],
    [
      'MsgUpdateMembers',
      (s) => msg(daoMsgs.MsgUpdateMembers, { authority: s, daoId: 1n, add: [OTHER] }),
    ],
    [
      'MsgSetDenomConfig',
      (s) =>
        msg(tokenfactoryMsgs.MsgSetDenomConfig, {
          creator: s,
          denom: 'factory/x/y',
          communityPool: OTHER,
          transferFee: '0',
          gasSurcharge: '0',
        }),
    ],
    ['MsgDisableMinting', (s) => msg(tokenfactoryMsgs.MsgDisableMinting, { creator: s })],
    ['MsgHaltChain', (s) => msg(guardianMsgs.MsgHaltChain, { signer: s, reason: 'r' })],
    [
      'MsgTightenRateLimit',
      (s) =>
        msg(guardianMsgs.MsgTightenRateLimit, {
          signer: s,
          denom: 'ubze',
          maxPercentSend: '1',
          maxPercentRecv: '1',
        }),
    ],
  ];

  it.each(cases)('%s: the signer is the connected address or the request is refused', (_, make) => {
    expect(code(request({}, [make(ME)]))).toBe('ok');
    expect(code(request({}, [make(OTHER)]))).toBe('multi-signer');
    expect(code(request({}, [make('')]))).toBe('multi-signer');
  });

  it('bad-body: a rate limit that is not a plain whole number', () => {
    const limit = (maxPercentSend: string) =>
      msg(guardianMsgs.MsgTightenRateLimit, {
        signer: ME,
        denom: 'ubze',
        maxPercentSend,
        maxPercentRecv: '1',
      });
    expect(code(request({}, [limit('05')]))).toBe('bad-body');
    expect(code(request({}, [limit('5')]))).toBe('ok');
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

// Hand-built protobuf bytes, for requests the wallet's own encoders never produce.
function varint(n: number): number[] {
  const out: number[] = [];
  let v = n;
  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
  return out;
}
/** The same number as `varint`, written one byte longer than needed. */
function paddedVarint(n: number): number[] {
  const out = varint(n);
  out[out.length - 1] = (out[out.length - 1] ?? 0) | 0x80;
  return [...out, 0];
}
const utf8 = (s: string): number[] => [...new TextEncoder().encode(s)];
const field = (no: number, payload: ArrayLike<number>): number[] => [
  ...varint((no << 3) | 2),
  ...varint(payload.length),
  ...Array.from(payload),
];
const text = (no: number, s: string): number[] => field(no, utf8(s));
const bytes = (...parts: ArrayLike<number>[]): Uint8Array =>
  Uint8Array.from(parts.flatMap((p) => Array.from(p)));
const anyBytes = (msg: AnyMsg): number[] => [...text(1, msg.typeUrl), ...field(2, msg.value)];
const coinBytes = (denom: string, amount: string): Uint8Array =>
  Coin.encode(Coin.fromPartial({ denom, amount })).finish();
const withBody = (bodyBytes: Uint8Array) =>
  request({ signDoc: { ...request().signDoc, bodyBytes } });

describe('verifySignRequest refuses requests that do not re-encode exactly', () => {
  const periodic = PeriodicAllowance.encode(
    PeriodicAllowance.fromPartial({
      basic: { spendLimit: [{ denom: 'uzz', amount: '1' }] },
      period: { seconds: 86_400n, nanos: 0 },
      periodSpendLimit: [{ denom: 'ubze', amount: '1000000' }],
    }),
  ).finish();
  const grantAllowance = (allowance: Uint8Array): AnyMsg => ({
    typeUrl: MsgGrantAllowance.typeUrl,
    value: bytes(
      text(1, ME),
      text(2, OTHER),
      field(3, [...text(1, PeriodicAllowance.typeUrl), ...field(2, allowance)]),
    ),
  });

  it('bad-body: a fee allowance whose limits are sent twice', () => {
    const first = BasicAllowance.encode(
      BasicAllowance.fromPartial({ spendLimit: [{ denom: 'ubze', amount: '100000000000000' }] }),
    ).finish();
    expect(code(request({}, [grantAllowance(bytes(field(1, first), periodic))]))).toBe('bad-body');
    // The same allowance, sent once, is fine (it carries no reset time, as dapps send it).
    expect(code(request({}, [grantAllowance(periodic)]))).toBe('ok');
  });

  it('bad-body: a swap whose amounts are sent twice', () => {
    const swap = (input: number[][], minOutput: number[][]): AnyMsg => ({
      typeUrl: MsgMultiSwap.typeUrl,
      value: bytes(text(1, ME), text(2, 'pool-1'), ...input, ...minOutput),
    });
    const input = field(3, coinBytes('ubze', '1000000000'));
    const output = field(4, coinBytes('uusdc', '1000'));
    const dup = swap(
      [input, field(3, coinBytes('ubze', ''))],
      [output, field(4, coinBytes('uusdc', ''))],
    );
    expect(code(request({}, [dup]))).toBe('bad-body');
    expect(code(request({}, [swap([input], [output])]))).toBe('ok');
  });

  it('bad-body: a memo that is not valid UTF-8', () => {
    const msg = field(1, anyBytes(send()));
    expect(code(withBody(bytes(msg, field(2, [0xc0, 0xb1, 0xc0, 0xb0, 0xc0, 0xb4]))))).toBe(
      'bad-body',
    );
    expect(code(withBody(bytes(msg, text(2, '104'))))).toBe('ok');
  });

  it('bad-body: transaction body fields the wallet does not show', () => {
    const plain = buildBody({ messages: [send()] });
    expect(code(withBody(plain))).toBe('ok');
    expect(code(withBody(bytes(plain, [0x20, 0x01])))).toBe('bad-body');
    expect(code(withBody(bytes(plain, field(5, [0x08, 0x01]))))).toBe('bad-body');
  });

  it('bad-body: an unordered transaction or a time-based timeout', () => {
    const body = (extra: { unordered?: boolean; timeoutTimestamp?: Date }) =>
      TxBody.encode(TxBody.fromPartial({ messages: [Any.fromPartial(send())], ...extra })).finish();
    expect(code(withBody(body({})))).toBe('ok');
    expect(code(withBody(body({ unordered: true })))).toBe('bad-body');
    expect(code(withBody(body({ timeoutTimestamp: new Date('2030-01-01T00:00:00Z') })))).toBe(
      'bad-body',
    );
  });

  it('bad-body: a body field sent twice, or a number or length written too long', () => {
    const msg = field(1, anyBytes(send()));
    expect(code(withBody(bytes(msg, text(2, 'a'), text(2, 'b'))))).toBe('bad-body');
    expect(code(withBody(bytes(msg, [0x18, 0x81, 0x00])))).toBe('bad-body');
    expect(code(withBody(bytes(msg, [0x18, 0x01])))).toBe('ok');
    const any = anyBytes(send());
    expect(code(withBody(bytes([0x0a, ...paddedVarint(any.length)], any)))).toBe('bad-body');
  });

  it('bad-body: unknown fields inside a message', () => {
    const value = bytes(send().value, text(15, 'extra'));
    expect(code(request({}, [{ typeUrl: MsgSend.typeUrl, value }]))).toBe('bad-body');
  });

  it('accepts sub-messages a dapp leaves out, or sends empty', () => {
    const transfer = (timeoutHeight?: { revisionNumber: bigint; revisionHeight: bigint }) => ({
      typeUrl: MsgTransfer.typeUrl,
      value: MsgTransfer.encode(
        MsgTransfer.fromPartial({
          sourcePort: 'transfer',
          sourceChannel: 'channel-0',
          token: { denom: 'ubze', amount: '1000' },
          sender: ME,
          receiver: 'osmo1abc',
          timeoutTimestamp: 1_900_000_000_000_000_000n,
          ...(timeoutHeight ? { timeoutHeight } : {}),
        }),
      ).finish(),
    });
    expect(code(request({}, [transfer()]))).toBe('ok');
    expect(code(request({}, [transfer({ revisionNumber: 0n, revisionHeight: 0n })]))).toBe('ok');
    expect(code(request({}, [transfer({ revisionNumber: 1n, revisionHeight: 99n })]))).toBe('ok');
  });

  it('never refuses a message built by the wallet encoders as bad-body', () => {
    for (const [name, codec] of allMsgs) {
      const msg: AnyMsg = {
        typeUrl: codec.typeUrl,
        value: codec.encode(codec.fromPartial({})).finish(),
      };
      expect([name, code(request({}, [msg]))]).not.toEqual([name, 'bad-body']);
    }
  });

  it.each(goldenCases)('$name: a body built by bzed is not refused as bad-body', (c) => {
    const from = c.messages[0]?.fromAddress ?? '';
    const base = request({ signer: from, connectedAddress: from });
    expect(
      code({ ...base, signDoc: { ...base.signDoc, bodyBytes: fromB64(c.bodyBytes) } }),
    ).not.toBe('bad-body');
  });
});

describe('verifySignRequest refuses amounts not written as plain whole numbers', () => {
  const BAD = ['0777777777', '010', '00', '0x10', '0b1', '0o17', '1_000', '+5', '-5', ' 5'];
  const GOOD = ['777777777', '10', '0'];
  const pack = <P, M>(
    codec: { typeUrl: string; fromPartial(p: P): M; encode(m: M): { finish(): Uint8Array } },
    partial: P,
  ): AnyMsg => ({
    typeUrl: codec.typeUrl,
    value: codec.encode(codec.fromPartial(partial)).finish(),
  });
  const makers: [string, (amount: string) => AnyMsg][] = [
    [
      'swap minimum',
      (amount) =>
        pack(MsgMultiSwap, {
          creator: ME,
          routes: ['pool-1'],
          input: { denom: 'ubze', amount: '1000' },
          minOutput: { denom: 'uusdc', amount },
        }),
    ],
    [
      'add-liquidity minimum',
      (amount) =>
        pack(MsgAddLiquidity, {
          creator: ME,
          poolId: 'pool-1',
          baseAmount: '1000',
          quoteAmount: '1000',
          minLpTokens: amount,
        }),
    ],
    [
      'remove-liquidity minimum',
      (amount) =>
        pack(MsgRemoveLiquidity, {
          creator: ME,
          poolId: 'pool-1',
          lpTokens: '1000',
          minBase: amount,
          minQuote: '1',
        }),
    ],
    [
      'order amount',
      (amount) =>
        pack(MsgCreateOrder, {
          creator: ME,
          orderType: 'buy',
          amount,
          price: '0.5',
          marketId: 'm',
        }),
    ],
    [
      'send amount',
      (amount) =>
        pack(MsgSend, { fromAddress: ME, toAddress: OTHER, amount: [{ denom: 'ubze', amount }] }),
    ],
    [
      'swap inside an authz exec',
      (amount) =>
        pack(MsgExec, {
          grantee: ME,
          msgs: [
            Any.fromPartial(
              pack(MsgMultiSwap, {
                creator: OTHER,
                routes: ['pool-1'],
                input: { denom: 'ubze', amount: '1000' },
                minOutput: { denom: 'uusdc', amount },
              }),
            ),
          ],
        }),
    ],
  ];

  it.each(makers)('%s', (_name, make) => {
    for (const amount of BAD)
      expect([amount, code(request({}, [make(amount)]))]).toEqual([amount, 'bad-body']);
    for (const amount of GOOD)
      expect([amount, code(request({}, [make(amount)]))]).toEqual([amount, 'ok']);
  });

  const fieldMakers: [string, (v: string) => AnyMsg][] = [
    [
      'order amount',
      (v) =>
        pack(MsgCreateOrder, {
          creator: ME,
          orderType: 'buy',
          amount: v,
          price: '1',
          marketId: 'm',
        }),
    ],
    [
      'fill item amount',
      (v) =>
        pack(MsgFillOrders, {
          creator: ME,
          marketId: 'm',
          orderType: 'buy',
          orders: [
            { price: '1', amount: '5' },
            { price: '1', amount: v },
          ],
        }),
    ],
    [
      'pool initial base',
      (v) =>
        pack(MsgCreateLiquidityPool, {
          creator: ME,
          base: 'ubze',
          quote: 'uusdc',
          initialBase: v,
          initialQuote: '1',
        }),
    ],
    [
      'pool initial quote',
      (v) =>
        pack(MsgCreateLiquidityPool, {
          creator: ME,
          base: 'ubze',
          quote: 'uusdc',
          initialBase: '1',
          initialQuote: v,
        }),
    ],
    [
      'add base amount',
      (v) =>
        pack(MsgAddLiquidity, {
          creator: ME,
          poolId: 'p',
          baseAmount: v,
          quoteAmount: '1',
          minLpTokens: '1',
        }),
    ],
    [
      'add quote amount',
      (v) =>
        pack(MsgAddLiquidity, {
          creator: ME,
          poolId: 'p',
          baseAmount: '1',
          quoteAmount: v,
          minLpTokens: '1',
        }),
    ],
    [
      'add min LP tokens',
      (v) =>
        pack(MsgAddLiquidity, {
          creator: ME,
          poolId: 'p',
          baseAmount: '1',
          quoteAmount: '1',
          minLpTokens: v,
        }),
    ],
    [
      'remove LP tokens',
      (v) =>
        pack(MsgRemoveLiquidity, {
          creator: ME,
          poolId: 'p',
          lpTokens: v,
          minBase: '1',
          minQuote: '1',
        }),
    ],
    [
      'remove min base',
      (v) =>
        pack(MsgRemoveLiquidity, {
          creator: ME,
          poolId: 'p',
          lpTokens: '1',
          minBase: v,
          minQuote: '1',
        }),
    ],
    [
      'remove min quote',
      (v) =>
        pack(MsgRemoveLiquidity, {
          creator: ME,
          poolId: 'p',
          lpTokens: '1',
          minBase: '1',
          minQuote: v,
        }),
    ],
    [
      'staking reward prize',
      (v) =>
        pack(rewardsMsgs.MsgCreateStakingReward, {
          creator: ME,
          prizeAmount: v,
          prizeDenom: 'ubze',
          stakingDenom: 'ubze',
          duration: '1',
          minStake: '1',
          lock: '1',
        }),
    ],
    [
      'staking reward min stake',
      (v) =>
        pack(rewardsMsgs.MsgCreateStakingReward, {
          creator: ME,
          prizeAmount: '1',
          prizeDenom: 'ubze',
          stakingDenom: 'ubze',
          duration: '1',
          minStake: v,
          lock: '1',
        }),
    ],
    [
      'trading reward prize',
      (v) =>
        pack(rewardsMsgs.MsgCreateTradingReward, {
          creator: ME,
          prizeAmount: v,
          prizeDenom: 'ubze',
          duration: '1',
          marketId: 'm',
          slots: '1',
        }),
    ],
    [
      'join staking',
      (v) => pack(rewardsMsgs.MsgJoinStaking, { creator: ME, rewardId: '1', amount: v }),
    ],
    [
      'distribute staking rewards',
      (v) =>
        pack(rewardsMsgs.MsgDistributeStakingRewards, { creator: ME, rewardId: '1', amount: v }),
    ],
    [
      'join denom reward',
      (v) => pack(rewardsMsgs.MsgJoinDenomReward, { creator: ME, denom: 'ubze', amount: v }),
    ],
    [
      'denom reward schedule',
      (v) =>
        pack(rewardsMsgs.MsgCreateDenomRewardSchedule, {
          creator: ME,
          denom: 'ubze',
          prizeDenom: 'ubze',
          dailyAmount: v,
          duration: '1',
        }),
    ],
    [
      'distribute denom rewards',
      (v) =>
        pack(rewardsMsgs.MsgDistributeDenomRewards, {
          creator: ME,
          denom: 'ubze',
          prizeDenom: 'ubze',
          amount: v,
        }),
    ],
    [
      'raffle pot',
      (v) =>
        pack(burnerMsgs.MsgStartRaffle, {
          creator: ME,
          pot: v,
          duration: '1',
          chances: '1',
          ratio: '0.1',
          ticketPrice: '1',
          denom: 'ubze',
        }),
    ],
    [
      'raffle duration',
      (v) =>
        pack(burnerMsgs.MsgStartRaffle, {
          creator: ME,
          pot: '1',
          duration: v,
          chances: '1',
          ratio: '0.1',
          ticketPrice: '1',
          denom: 'ubze',
        }),
    ],
    [
      'raffle chances',
      (v) =>
        pack(burnerMsgs.MsgStartRaffle, {
          creator: ME,
          pot: '1',
          duration: '1',
          chances: v,
          ratio: '0.1',
          ticketPrice: '1',
          denom: 'ubze',
        }),
    ],
    [
      'raffle ticket price',
      (v) =>
        pack(burnerMsgs.MsgStartRaffle, {
          creator: ME,
          pot: '1',
          duration: '1',
          chances: '1',
          ratio: '0.1',
          ticketPrice: v,
          denom: 'ubze',
        }),
    ],
  ];

  it.each(fieldMakers)('every listed integer field: %s', (_name, make) => {
    expect(code(request({}, [make('010')]))).toBe('bad-body');
    expect(code(request({}, [make('10')]))).not.toBe('bad-body');
  });

  it('leaves decimal prices alone', () => {
    const order = (price: string) =>
      pack(MsgCreateOrder, { creator: ME, orderType: 'buy', amount: '1', price, marketId: 'm' });
    expect(code(request({}, [order('0.335')]))).toBe('ok');
  });
});

describe('verifySignRequest bounds nested messages', () => {
  const NESTED = '/google.protobuf.Any';
  /** An authz exec whose message is wrapped `depth` times, built without quadratic copying. */
  function nestedExec(depth: number): AnyMsg {
    const inner = Uint8Array.from(anyBytes(send()));
    const header = text(1, NESTED);
    const lengths = [inner.length];
    for (let k = 1; k <= depth; k += 1) {
      const prev = lengths[k - 1] ?? 0;
      lengths.push(header.length + 1 + varint(prev).length + prev);
    }
    const out = new Uint8Array(lengths[depth] ?? 0);
    let pos = 0;
    for (let k = depth; k >= 1; k -= 1) {
      const prev = lengths[k - 1] ?? 0;
      out.set(header, pos);
      pos += header.length;
      const len = [0x12, ...varint(prev)];
      out.set(len, pos);
      pos += len.length;
    }
    out.set(inner, pos);
    return { typeUrl: MsgExec.typeUrl, value: bytes(text(1, ME), field(2, out)) };
  }

  it('accepts a shallow nesting', () => {
    expect(code(request({}, [nestedExec(3)]))).toBe('ok');
  });

  it('accepts 8 nested levels below the exec and refuses 9', () => {
    // nestedExec(n) holds n wrappers around a send: n + 1 levels below the exec.
    expect(code(request({}, [nestedExec(7)]))).toBe('ok');
    expect(code(request({}, [nestedExec(8)]))).toBe('bad-body');
  });

  it.each([20, 500, 2000, 8000])('bad-body, quickly, at depth %i', (depth) => {
    const msg = nestedExec(depth);
    const started = performance.now();
    expect(code(request({}, [msg]))).toBe('bad-body');
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
