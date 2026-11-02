import { startRelay } from './relay';

/** Content script, isolated world. */
startRelay(window, chrome.runtime);
