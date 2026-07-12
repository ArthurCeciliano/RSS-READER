import {
  buildInstagramIdentityUrl,
  buildRedditFeedUrl,
  buildTikTokIdentityUrl,
  buildYouTubeChannelFeedUrl,
  buildYouTubePlaylistFeedUrl,
  ensureUrl,
  extractInstagramUsername,
  extractTikTokUsername,
  extractYouTubeChannelId,
  extractYouTubeHandle,
  extractYouTubePlaylistId,
  isRedditUrl,
  normalizeIdentityUrl,
} from './urlNormalizer.js';
import { buildConventionalFeedUrls, discoverFeedLinksFromHtml, looksLikeFeedContent } from './feedDiscovery.js';

export type ResolvedSourceType =
  | 'rss'
  | 'atom'
  | 'json_feed'
  | 'youtube'
  | 'instagram'
  | 'tiktok'
  | 'reddit'
  | 'twitter';

export interface ResolvedSource {
  type: ResolvedSourceType;
  identityUrl: string;
  /** Null for bridge-backed sources (instagram/tiktok): resolved at fetch time from configured bridges. */
  feedUrl: string | null;
  siteUrl?: string;
  title?: string;
}

export interface FeedCandidate {
  title: string;
  feedUrl: string;
}

export type ResolveResult =
  | { kind: 'resolved'; source: ResolvedSource }
  | { kind: 'choice'; candidates: FeedCandidate[]; siteUrl: string }
  | { kind: 'unresolved'; reason: string };

export interface HttpClient {
  getText(url: string): Promise<{ status: number; body: string; contentType: string | null }>;
}

/**
 * Deterministic, network-free classification for sources whose type/feed URL
 * can be derived from the URL shape alone (module 1, cases 3/4/5/6 minus the
 * YouTube @handle case, which needs a page fetch to resolve a channel id).
 */
export function classifyDeterministic(input: string): ResolvedSource | null {
  const channelId = extractYouTubeChannelId(input);
  if (channelId) {
    return {
      type: 'youtube',
      identityUrl: normalizeIdentityUrl(`https://www.youtube.com/channel/${channelId}`),
      feedUrl: buildYouTubeChannelFeedUrl(channelId),
    };
  }

  const playlistId = extractYouTubePlaylistId(input);
  if (playlistId) {
    const feedUrl = buildYouTubePlaylistFeedUrl(playlistId);
    return { type: 'youtube', identityUrl: normalizeIdentityUrl(feedUrl), feedUrl };
  }

  const igUser = extractInstagramUsername(input);
  if (igUser) {
    const identityUrl = buildInstagramIdentityUrl(igUser);
    return { type: 'instagram', identityUrl, feedUrl: null, title: igUser };
  }

  const ttUser = extractTikTokUsername(input);
  if (ttUser) {
    const identityUrl = buildTikTokIdentityUrl(ttUser);
    return { type: 'tiktok', identityUrl, feedUrl: null, title: ttUser };
  }

  if (isRedditUrl(input)) {
    const feedUrl = buildRedditFeedUrl(input);
    return { type: 'reddit', identityUrl: normalizeIdentityUrl(feedUrl), feedUrl };
  }

  return null;
}

/**
 * Full resolver (module 1): tries deterministic classification first, then
 * falls back to network-assisted resolution (YouTube handle -> channel id,
 * "is this URL itself a feed", generic site feed discovery via <link> tags
 * and conventional paths).
 */
export async function resolveSource(input: string, http: HttpClient): Promise<ResolveResult> {
  const deterministic = classifyDeterministic(input);
  if (deterministic) return { kind: 'resolved', source: deterministic };

  const handle = extractYouTubeHandle(input);
  if (handle) {
    const channelPageUrl = ensureUrl(input).toString();
    const page = await http.getText(channelPageUrl);
    const channelId = extractChannelIdFromYouTubePage(page.body);
    if (channelId) {
      return {
        kind: 'resolved',
        source: {
          type: 'youtube',
          identityUrl: normalizeIdentityUrl(`https://www.youtube.com/channel/${channelId}`),
          feedUrl: buildYouTubeChannelFeedUrl(channelId),
        },
      };
    }
    return { kind: 'unresolved', reason: 'could_not_resolve_youtube_channel_id' };
  }

  // Case 1: URL might already be a feed.
  const direct = await http.getText(ensureUrl(input).toString());
  if (direct.status >= 200 && direct.status < 400 && looksLikeFeedContent(direct.body)) {
    const feedUrl = ensureUrl(input).toString();
    const type = direct.body.trimStart().startsWith('{') ? 'json_feed' : detectXmlFeedType(direct.body);
    return { kind: 'resolved', source: { type, identityUrl: normalizeIdentityUrl(feedUrl), feedUrl } };
  }

  // Case 2: generic site -> discover feed links.
  const siteUrl = ensureUrl(input).toString();
  const discovered = discoverFeedLinksFromHtml(direct.body, siteUrl);
  if (discovered.length === 1) {
    const feedUrl = discovered[0].href;
    return {
      kind: 'resolved',
      source: { type: detectTypeFromMime(discovered[0].type), identityUrl: normalizeIdentityUrl(feedUrl), feedUrl, siteUrl },
    };
  }
  if (discovered.length > 1) {
    return {
      kind: 'choice',
      siteUrl,
      candidates: discovered.map((d) => ({ title: d.title || d.href, feedUrl: d.href })),
    };
  }

  for (const candidate of buildConventionalFeedUrls(siteUrl)) {
    const res = await http.getText(candidate);
    if (res.status >= 200 && res.status < 400 && looksLikeFeedContent(res.body)) {
      return {
        kind: 'resolved',
        source: {
          type: detectXmlFeedType(res.body),
          identityUrl: normalizeIdentityUrl(candidate),
          feedUrl: candidate,
          siteUrl,
        },
      };
    }
  }

  return { kind: 'unresolved', reason: 'no_feed_found' };
}

function detectXmlFeedType(body: string): 'rss' | 'atom' {
  return /<feed[\s>]/i.test(body.slice(0, 2000)) ? 'atom' : 'rss';
}

function detectTypeFromMime(mime: string): 'rss' | 'atom' | 'json_feed' {
  if (mime.includes('atom')) return 'atom';
  if (mime.includes('json')) return 'json_feed';
  return 'rss';
}

function extractChannelIdFromYouTubePage(html: string): string | null {
  const jsonMatch = html.match(/"channelId":"(UC[\w-]{10,})"/);
  if (jsonMatch) return jsonMatch[1];
  const canonicalMatch = html.match(
    /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{10,})"/,
  );
  if (canonicalMatch) return canonicalMatch[1];
  return null;
}
