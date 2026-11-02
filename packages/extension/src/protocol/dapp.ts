import type { NetworkId } from '@beepocket/core';
import type { ReviewedFee, SignView } from './dapp-sign';
import type { WalletAddress } from './wallet';

export type { ReviewedFee, SignDetails, SignView } from './dapp-sign';

/** Error codes of the `dapp.*` methods (`ProtocolError.code`). */
export const DappProtocolCodes = {
  /** There is no such pending request (answered already, or its tab is gone). */
  unknownRequest: 'unknown-request',
  /** The site is not connected on the active network (disconnected already). */
  unknownSite: 'unknown-site',
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
    }
  /** A site asks for a transaction to be signed: show it in plain words. */
  | SignView;

/** The request window's view, with the queue behind it. */
export type CurrentRequest = RequestView & {
  /** Requests waiting in all, this one included (absent: just this one). */
  count?: number;
  /** Epoch ms at which the request expires. */
  expiresAt?: number;
};

/** Who is waiting, for the unlock screen. */
export interface QueueView {
  /** The origin of the request at the head, or null when nothing waits. */
  head: string | null;
  count: number;
  /** Distinct origins, oldest request first. */
  origins: string[];
}

/** Methods the request window calls. Own pages only. */
export interface DappProtocol {
  /** The head of the queue; settles it first when the wallet can already answer. */
  'dapp.current': { req: Record<string, never>; res: CurrentRequest };
  /** Who is waiting; allowed while the wallet is locked. */
  'dapp.queue': { req: Record<string, never>; res: QueueView };
  /** Opens (or focuses) the request window when something waits. */
  'dapp.open': { req: Record<string, never>; res: Record<string, never> };
  /** The user's answer: Cancel (`approve: false`) or Connect with the picked address `index`. */
  'dapp.answer': {
    req: {
      id: string;
      approve: boolean;
      index?: number;
      fee?: ReviewedFee;
      /** The user ticked "I set this up myself and trust this address" (dangerous requests). */
      trusted?: boolean;
    };
    res: Record<string, never>;
  };
}

/** A connected site as Settings lists it: the one address it sees. */
export interface ConnectedSiteView {
  origin: string;
  /** The address's current label and address. */
  label: string;
  address: string;
  /** Epoch ms. */
  connectedAt: number;
}

/** Methods of Settings › Connected sites. Own pages only. */
export interface SitesProtocol {
  /** The sites of the active network, newest first, and the addresses a site can be moved to. */
  'sites.list': {
    req: Record<string, never>;
    res: { network: NetworkId; sites: ConnectedSiteView[]; addresses: WalletAddress[] };
  };
  /** Gives the site another address and tells its open pages. Needs the wallet unlocked. */
  'sites.change': { req: { origin: string; index: number }; res: Record<string, never> };
  /** Forgets the site and tells its open pages. Needs the wallet unlocked. */
  'sites.disconnect': { req: { origin: string }; res: Record<string, never> };
}
