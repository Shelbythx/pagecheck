import type { Resolver } from './types.ts';

function decodeXml(value: string): string {
  return value
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

/**
 * Reads page URLs from a sitemap.xml. Follows one level of sitemap index files
 * (the format WordPress and most generators produce) and stops at `limit`.
 */
export async function urlsFromSitemap(url: URL, resolver: Resolver, limit: number): Promise<string[]> {
  const xml = await resolver.text(url);
  const locations = [...xml.matchAll(/<loc>([\s\S]*?)<\/loc>/gi)].map((match) => decodeXml(match[1] ?? ''));

  if (/<sitemapindex[\s>]/i.test(xml)) {
    const pages: string[] = [];
    for (const child of locations) {
      if (pages.length >= limit) break;
      pages.push(...(await urlsFromSitemap(new URL(child, url), resolver, limit - pages.length)));
    }
    return pages.slice(0, limit);
  }

  return [...new Set(locations.filter(Boolean))].slice(0, limit);
}
