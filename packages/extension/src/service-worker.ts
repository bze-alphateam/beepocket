import { startBackground } from './background/main';

startBackground({ chrome, crypto, fetch: fetch.bind(globalThis) });
