import type { AppProtocol } from './app';
import type { WalletProtocol } from './wallet';
import type { FeatureProtocol } from './types';

export * from './types';
export type { AppProtocol } from './app';
export * from './wallet';

/**
 * Every method the popup can call. Each feature adds one `FeatureProtocol` here:
 * `export type Protocol = FeatureProtocol<AppProtocol> & FeatureProtocol<WalletProtocol>`.
 */
export type Protocol = FeatureProtocol<AppProtocol> & FeatureProtocol<WalletProtocol>;

export type Method = keyof Protocol;
export type RequestOf<M extends Method> = Protocol[M]['req'];
export type ResponseOf<M extends Method> = Protocol[M]['res'];
