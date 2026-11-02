import './shim';
import { beePocketInfo, beePocketWallet } from '@bze/beepocket-connector';
import { WalletManager, type CosmosWallet } from '@interchain-kit/core';

// The test dapp talks to BeePocket the way the BZE dapps do: through interchain-kit's
// WalletManager and the `beePocketWallet` of the connector package.
const CHAIN_ID = 'beezee-1';
const CHAIN_NAME = 'beezee';

const BZE_CHAIN = {
  chainId: CHAIN_ID,
  chainName: CHAIN_NAME,
  chainType: 'cosmos',
  bech32Prefix: 'bze',
  apis: { rpc: [], rest: [] },
};

interface Account {
  address: string;
  username?: string;
  pubkey: Uint8Array;
}

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing #${id}`);
  return found;
}

const result = element('result');
const manager = new WalletManager([BZE_CHAIN as never], [], [beePocketWallet]);
const ready = manager.init();

// Counts the wallet's own `accountChanged`, as interchain-kit's React provider listens to it.
const accountChanges = element('account-changes');
let changes = 0;
beePocketWallet.events.on('accountChanged', () => {
  changes++;
  accountChanges.textContent = String(changes);
});

const show = (call: () => Promise<Account>): Promise<void> =>
  call().then(
    (account) => {
      result.textContent = `address ${account.address} name ${account.username ?? ''}`;
    },
    (error: unknown) => {
      result.textContent = `error ${errorText(error)}`;
    },
  );

function errorText(error: unknown): string {
  const failure = error as { code?: string; message?: string };
  return failure.code ?? failure.message ?? 'unknown';
}

const account = async (): Promise<Account> => {
  await ready;
  return await manager.getAccount(beePocketInfo.name, CHAIN_NAME);
};

element('connect').addEventListener('click', () => {
  void show(async () => {
    await ready;
    await manager.connect(beePocketInfo.name, CHAIN_NAME);
    return account();
  });
});
element('get-key').addEventListener('click', () => {
  void show(account);
});

// A tiny protobuf writer: just enough for one MsgSend, so the page needs no library.
const encoder = new TextEncoder();
const cat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const varint = (value: number | bigint): Uint8Array => {
  let n = BigInt(value);
  const bytes: number[] = [];
  do {
    let b = Number(n & 0x7fn);
    n >>= 7n;
    if (n > 0n) b |= 0x80;
    bytes.push(b);
  } while (n > 0n);
  return Uint8Array.from(bytes);
};
const bytesField = (no: number, bytes: Uint8Array): Uint8Array =>
  cat(varint((no << 3) | 2), varint(bytes.length), bytes);
const textField = (no: number, text: string): Uint8Array => bytesField(no, encoder.encode(text));
const numberField = (no: number, n: number): Uint8Array => cat(varint(no << 3), varint(n));
const any = (typeUrl: string, value: Uint8Array): Uint8Array =>
  cat(textField(1, typeUrl), bytesField(2, value));
const fromBase64 = (text: string): Uint8Array =>
  Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

const sendMsg = (key: Account, to: string): Uint8Array => {
  const coin = cat(textField(1, 'ubze'), textField(2, '1000000'));
  const msg = cat(textField(1, key.address), textField(2, to), bytesField(3, coin));
  return any('/cosmos.bank.v1beta1.MsgSend', msg);
};
// A generic authorization to send on the signer's behalf: a dangerous message.
const grantMsg = (key: Account, grantee: string): Uint8Array => {
  const authorization = any(
    '/cosmos.authz.v1beta1.GenericAuthorization',
    textField(1, '/cosmos.bank.v1beta1.MsgSend'),
  );
  const msg = cat(
    textField(1, key.address),
    textField(2, grantee),
    bytesField(3, bytesField(1, authorization)),
  );
  return any('/cosmos.authz.v1beta1.MsgGrant', msg);
};
// A message type the wallet has never heard of, with arbitrary bytes.
const nothingMsg = (): Uint8Array => any('/test.v1.MsgNothing', Uint8Array.from([1, 2, 3, 250]));

function sendDoc(key: Account, messages: Uint8Array[]) {
  const bodyBytes = cat(...messages.map((m) => bytesField(1, m)));
  const pubKey = any('/cosmos.crypto.secp256k1.PubKey', bytesField(1, key.pubkey));
  const signerInfo = cat(
    bytesField(1, pubKey),
    bytesField(2, bytesField(1, numberField(1, 1))),
    numberField(3, 0),
  );
  // The wallet replaces this fee with its own.
  const authInfoBytes = cat(bytesField(1, signerInfo), bytesField(2, numberField(2, 1)));
  return { bodyBytes, authInfoBytes, chainId: CHAIN_ID, accountNumber: 7n };
}

const cosmos = (): CosmosWallet => beePocketWallet.getWalletByChainType('cosmos') as CosmosWallet;

const signAndSend = (messagesOf: (key: Account, to: string) => Uint8Array[]): void => {
  void (async () => {
    try {
      const key = await account();
      const to = (element('to') as HTMLInputElement).value;
      const { signed, signature } = await cosmos().signDirect(
        CHAIN_ID,
        key.address,
        sendDoc(key, messagesOf(key, to)),
      );
      const txRaw = cat(
        bytesField(1, signed.bodyBytes),
        bytesField(2, signed.authInfoBytes),
        bytesField(3, fromBase64(signature.signature)),
      );
      // The wallet only broadcasts in sync mode.
      const hash = await cosmos().sendTx(CHAIN_ID, txRaw, 'sync' as never);
      result.textContent = `hash ${Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('')}`;
    } catch (error) {
      result.textContent = `error ${errorText(error)}`;
    }
    // Every outcome of a send, in the order the answers arrived.
    const item = document.createElement('li');
    item.textContent = result.textContent;
    element('log').append(item);
  })();
};

element('send').addEventListener('click', () => {
  signAndSend((key, to) => [sendMsg(key, to)]);
});
element('grant').addEventListener('click', () => {
  signAndSend((key, to) => [grantMsg(key, to)]);
});
element('send-unknown').addEventListener('click', () => {
  signAndSend((key, to) => [sendMsg(key, to), nothingMsg()]);
});
