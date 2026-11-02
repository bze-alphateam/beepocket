import { Buffer } from 'buffer';

// interchain-kit expects Node's Buffer; a dapp's bundler provides it the same way.
(globalThis as { Buffer?: typeof Buffer }).Buffer ??= Buffer;
