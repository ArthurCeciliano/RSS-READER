import Parser from 'rss-parser';

export interface ParsedFeedItem {
  guid?: string;
  link?: string;
  title: string;
  summary?: string;
  contentHtml?: string;
  imageUrl?: string;
  author?: string;
  publishedAt?: Date;
}

export interface ParsedFeed {
  title?: string;
  items: ParsedFeedItem[];
}

const parser = new Parser({
  customFields: {
    item: [
      ['media:content', 'mediaContent', { keepArray: true }],
      ['media:thumbnail', 'mediaThumbnail'],
      // YouTube (and other Media RSS feeds) nest thumbnail/description/content
      // inside <media:group> rather than as direct item children.
      ['media:group', 'mediaGroup'],
    ],
  },
});

function firstImageFromHtml(html: string | undefined): string | undefined {
  if (!html) return undefined;
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match?.[1];
}

function mediaGroupThumbnail(mediaGroup: any): string | undefined {
  return mediaGroup?.['media:thumbnail']?.[0]?.$?.url;
}

function mediaGroupDescription(mediaGroup: any): string | undefined {
  const description = mediaGroup?.['media:description']?.[0];
  return typeof description === 'string' ? description : undefined;
}

function extractImage(raw: any): string | undefined {
  const fromGroup = mediaGroupThumbnail(raw.mediaGroup);
  if (fromGroup) return fromGroup;
  if (raw.mediaThumbnail?.$?.url) return raw.mediaThumbnail.$.url;
  const mediaContent = raw.mediaContent?.[0]?.$?.url;
  if (mediaContent && /\.(jpe?g|png|webp|gif)(\?|$)/i.test(mediaContent)) return mediaContent;
  if (raw.enclosure?.url && /^image\//.test(raw.enclosure.type ?? '')) return raw.enclosure.url;
  return firstImageFromHtml(raw['content:encoded'] ?? raw.content);
}

function extractSummary(raw: any): string | undefined {
  return raw.contentSnippet ?? mediaGroupDescription(raw.mediaGroup);
}

/** Normalizes an rss-parser feed (RSS 2.0, Atom, RDF) into a flat item list. */
export function parseFeed(raw: { title?: string; items: unknown[] }): ParsedFeed {
  const items: ParsedFeedItem[] = raw.items.map((item: any) => ({
    guid: item.guid ?? item.id ?? undefined,
    link: item.link ?? undefined,
    title: item.title ?? '(untitled)',
    summary: extractSummary(item),
    contentHtml: item['content:encoded'] ?? item.content ?? undefined,
    imageUrl: extractImage(item),
    author: item.creator ?? item.author ?? undefined,
    publishedAt: item.isoDate ? new Date(item.isoDate) : item.pubDate ? new Date(item.pubDate) : undefined,
  }));

  return { title: raw.title, items };
}

export async function parseFeedXml(xml: string): Promise<ParsedFeed> {
  const raw = await parser.parseString(xml);
  return parseFeed(raw);
}
