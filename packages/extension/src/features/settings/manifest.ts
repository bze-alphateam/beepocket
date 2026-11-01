/** Where the About row gets the version from; injected so tests need no `chrome`. */
export interface ManifestSource {
  version(): string;
}

export const chromeManifest: ManifestSource = {
  version: () => chrome.runtime.getManifest().version,
};
