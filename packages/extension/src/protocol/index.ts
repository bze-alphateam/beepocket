import type { AppProtocol } from './app';

export * from './types';
export type { AppProtocol } from './app';

/**
 * Every method the popup can call. Each feature adds one `FeatureProtocol` here:
 * `export type Protocol = AppProtocol & WalletProtocol & ...`.
 */
export type Protocol = AppProtocol;

export type Method = keyof Protocol & string;
export type RequestOf<M extends Method> = Protocol[M]['req'];
export type ResponseOf<M extends Method> = Protocol[M]['res'];
