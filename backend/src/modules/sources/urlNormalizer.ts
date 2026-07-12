/**
 * Ensures a user-pasted URL has a scheme, trims whitespace, and lower-cases
 * the hostname (paths/query stay case-sensitive since many sites care).
 */
export function ensureUrl(input: string): URL {
  const trimmed = input.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withScheme);
  url.hostname = url.hostname.toLowerCase();
  return url;
}

function stripTrailingSlash(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

export function extractInstagramUsername(input: string): string | null {
  let url: URL;
  try {
    url = ensureUrl(input);
  } catch {
    return null;
  }
  if (!/(^|\.)instagram\.com$/i.test(url.hostname)) return null;
  const segments = stripTrailingSlash(url.pathname).split('/').filter(Boolean);
  if (segments.length === 0) return null;
  const reserved = new Set(['p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'direct', 'tv']);
  const first = segments[0].replace(/^@/, '');
  if (reserved.has(first.toLowerCase())) return null;
  return first;
}

export function extractTikTokUsername(input: string): string | null {
  let url: URL;
  try {
    url = ensureUrl(input);
  } catch {
    return null;
  }
  if (!/(^|\.)tiktok\.com$/i.test(url.hostname)) return null;
  const segments = stripTrailingSlash(url.pathname).split('/').filter(Boolean);
  const handleSeg = segments.find((s) => s.startsWith('@'));
  if (!handleSeg) return null;
  return handleSeg.replace(/^@/, '');
}

export function buildInstagramIdentityUrl(username: string): string {
  return `https://www.instagram.com/${username}/`;
}

export function buildTikTokIdentityUrl(username: string): string {
  return `https://www.tiktok.com/@${username}/`;
}

export function extractYouTubeChannelId(input: string): string | null {
  let url: URL;
  try {
    url = ensureUrl(input);
  } catch {
    return null;
  }
  if (!/(^|\.)youtube\.com$/i.test(url.hostname)) return null;

  const fromQuery = url.searchParams.get('channel_id');
  if (fromQuery) return fromQuery;

  const segments = stripTrailingSlash(url.pathname).split('/').filter(Boolean);
  const idx = segments.indexOf('channel');
  if (idx >= 0 && segments[idx + 1]) return segments[idx + 1];

  return null;
}

export function extractYouTubePlaylistId(input: string): string | null {
  let url: URL;
  try {
    url = ensureUrl(input);
  } catch {
    return null;
  }
  if (!/(^|\.)youtube\.com$/i.test(url.hostname)) return null;
  return url.searchParams.get('playlist_id') ?? url.searchParams.get('list');
}

export interface YouTubeHandleRef {
  kind: 'handle' | 'user' | 'c';
  value: string;
}

export function extractYouTubeHandle(input: string): YouTubeHandleRef | null {
  let url: URL;
  try {
    url = ensureUrl(input);
  } catch {
    return null;
  }
  if (!/(^|\.)youtube\.com$/i.test(url.hostname)) return null;

  const segments = stripTrailingSlash(url.pathname).split('/').filter(Boolean);
  if (segments.length === 0) return null;

  if (segments[0].startsWith('@')) {
    return { kind: 'handle', value: segments[0].slice(1) };
  }
  if (segments[0] === 'user' && segments[1]) {
    return { kind: 'user', value: segments[1] };
  }
  if (segments[0] === 'c' && segments[1]) {
    return { kind: 'c', value: segments[1] };
  }
  return null;
}

export function buildYouTubeChannelFeedUrl(channelId: string): string {
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
}

export function buildYouTubePlaylistFeedUrl(playlistId: string): string {
  return `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`;
}

export function isRedditUrl(input: string): boolean {
  try {
    return /(^|\.)reddit\.com$/i.test(ensureUrl(input).hostname);
  } catch {
    return false;
  }
}

export function buildRedditFeedUrl(input: string): string {
  const url = ensureUrl(input);
  const path = stripTrailingSlash(url.pathname);
  if (path.endsWith('.rss')) return `${url.origin}${path}`;
  return `${url.origin}${path}/.rss`;
}

/**
 * Best-effort canonical identity URL: lower-cased host, fragment removed,
 * trailing slash collapsed. Query strings are always preserved verbatim —
 * for many sources (bridge URLs, playlist/channel feeds) the query IS the
 * resource locator, so stripping it would collide unrelated sources.
 */
export function normalizeIdentityUrl(input: string): string {
  const url = ensureUrl(input);
  url.hash = '';
  url.pathname = stripTrailingSlash(url.pathname) || '/';
  return url.toString();
}
