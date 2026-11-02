import type { NetworkId } from '@beepocket/core';
import type { WalletAddress } from './wallet';

/** Error codes of the `dapp.*` methods (`ProtocolError.code`). */
export const DappProtocolCodes = {
  /** There is no such pending request (answered already, or its tab is gone). */
  unknownRequest: 'unknown-request',
} as const;

/** What the request window shows for the request that is waiting. */
export type RequestView =
  /** Nothing waits: the window can close. */
  | { status: 'none' }
  /** The wallet is fully locked: show the unlock screen, then ask again. */
  | { status: 'locked'; origin: string }
  /** The weak lock must be lifted before the wallet can answer: ask the password, then ask again. */
  | { status: 'unlock'; origin: string }
  /** A site asks to connect: let the user pick the one address it may see. */
  | {
      status: 'connect';
      id: string;
      origin: string;
      network: NetworkId;
      addresses: WalletAddress[];
    };

/** Methods the request window calls. Own pages only. */
export interface DappProtocol {
  /** The oldest waiting request; settles it first when the wallet can already answer. */
  'dapp.current': { req: Record<string, never>; res: RequestView };
  /** The user's answer: Cancel (`approve: false`) or Connect with the picked address `index`. */
  'dapp.answer': {
    req: { id: string; approve: boolean; index?: number };
    res: Record<string, never>;
  };
}
