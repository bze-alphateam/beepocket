import { createContext, type ComponentChildren } from 'preact';
import { useContext } from 'preact/hooks';

/** Where a connected site's icon comes from. `null` means no icon: the letter shows. */
export interface SiteIcons {
  url(origin: string): string | null;
}

/** No icons at all: every site shows its letter. */
export const noSiteIcons: SiteIcons = { url: () => null };

/**
 * The browser's own favicon cache (the `favicon` permission): a URL inside the extension, so
 * nothing is ever fetched from the site. A site the browser has no icon for gets its default one.
 */
export function browserSiteIcons(runtime: { getURL(path: string): string }): SiteIcons {
  return {
    url: (origin) =>
      `${runtime.getURL('/_favicon/')}?pageUrl=${encodeURIComponent(origin)}&size=32`,
  };
}

const SiteIconsContext = createContext<SiteIcons>(noSiteIcons);

export function SiteIconsProvider(props: { icons: SiteIcons; children: ComponentChildren }) {
  return (
    <SiteIconsContext.Provider value={props.icons}>{props.children}</SiteIconsContext.Provider>
  );
}

export function useSiteIcons(): SiteIcons {
  return useContext(SiteIconsContext);
}
