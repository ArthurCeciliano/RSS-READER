import { JSDOM } from 'jsdom';

export const CONVENTIONAL_FEED_PATHS = ['/feed', '/rss', '/rss.xml', '/atom.xml', '/feed.xml', '/index.xml'];

export interface DiscoveredFeedLink {
  title: string;
  href: string;
  type: string;
}

const FEED_MIME_TYPES = new Set([
  'application/rss+xml',
  'application/atom+xml',
  'application/feed+json',
  'application/json',
]);

/**
 * Extracts <link rel="alternate" type="application/rss+xml|atom+xml"> feed
 * references from a page's HTML, resolved to absolute URLs.
 */
export function discoverFeedLinksFromHtml(html: string, baseUrl: string): DiscoveredFeedLink[] {
  const dom = new JSDOM(html);
  const links = Array.from(dom.window.document.querySelectorAll('link[rel="alternate"]'));
  const results: DiscoveredFeedLink[] = [];

  for (const link of links) {
    const type = (link.getAttribute('type') ?? '').toLowerCase();
    const href = link.getAttribute('href');
    if (!href || !FEED_MIME_TYPES.has(type)) continue;
    try {
      const absolute = new URL(href, baseUrl).toString();
      results.push({ title: link.getAttribute('title') ?? '', href: absolute, type });
    } catch {
      // ignore malformed href
    }
  }

  return results;
}

/** Heuristic check that fetched text is itself RSS/Atom/JSON Feed content. */
export function looksLikeFeedContent(text: string): boolean {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{')) {
    return /"version"\s*:\s*"https:\/\/jsonfeed\.org/i.test(trimmed.slice(0, 500));
  }
  const head = trimmed.slice(0, 2000);
  return /<rss[\s>]/i.test(head) || /<feed[\s>]/i.test(head) || /<rdf:RDF[\s>]/i.test(head);
}

export function buildConventionalFeedUrls(baseUrl: string): string[] {
  const url = new URL(baseUrl);
  return CONVENTIONAL_FEED_PATHS.map((path) => `${url.origin}${path}`);
}
