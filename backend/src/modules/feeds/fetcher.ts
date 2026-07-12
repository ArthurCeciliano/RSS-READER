export interface ConditionalState {
  etag?: string | null;
  lastModified?: string | null;
}

/** Builds If-None-Match/If-Modified-Since headers so an unchanged feed costs a cheap 304, not a re-parse. */
export function buildConditionalHeaders(state: ConditionalState): Record<string, string> {
  const headers: Record<string, string> = {};
  if (state.etag) headers['If-None-Match'] = state.etag;
  if (state.lastModified) headers['If-Modified-Since'] = state.lastModified;
  return headers;
}

export interface FetchFeedResult {
  notModified: boolean;
  status: number;
  body: string | null;
  etag: string | null;
  lastModified: string | null;
}

export async function fetchFeed(url: string, state: ConditionalState, userAgent = 'rss-reader/1.0'): Promise<FetchFeedResult> {
  const response = await fetch(url, {
    headers: {
      ...buildConditionalHeaders(state),
      'User-Agent': userAgent,
      Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, application/json;q=0.9, */*;q=0.8',
    },
  });

  if (response.status === 304) {
    return { notModified: true, status: 304, body: null, etag: state.etag ?? null, lastModified: state.lastModified ?? null };
  }

  const body = await response.text();
  return {
    notModified: false,
    status: response.status,
    body,
    etag: response.headers.get('etag'),
    lastModified: response.headers.get('last-modified'),
  };
}
