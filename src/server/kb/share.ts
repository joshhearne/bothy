import "server-only";
import { getKbPublicSettings } from "@/server/services/settings";

/**
 * The address of something on the public site, for handing to somebody who
 * reads there. Only when they could open it: the site is on, it has an
 * address, the collection is on it, and the article is not held back.
 * Otherwise null, and nothing is offered.
 */
export async function publicAddressFor(item: {
  id: string;
  collectionPublic: boolean;
  publicHidden?: boolean;
  /** A collection's address differs from an article's; an article of any kind is an article. */
  target?: "article" | "collection";
}): Promise<string | null> {
  if (!item.collectionPublic || item.publicHidden) return null;
  const settings = await getKbPublicSettings();
  if (settings.mode === "off" || !settings.url) return null;
  const path = item.target === "collection" ? `/pub/kb/${item.id}` : `/pub/kb/articles/${item.id}`;
  return `${settings.url.replace(/\/+$/, "")}${path}`;
}
