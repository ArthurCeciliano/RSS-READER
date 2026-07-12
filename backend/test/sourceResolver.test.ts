import { describe, expect, it } from 'vitest';
import { classifyDeterministic, resolveSource, type HttpClient } from '../src/modules/sources/sourceResolver.js';

describe('classifyDeterministic', () => {
  it('classifies a YouTube channel feed URL', () => {
    const result = classifyDeterministic(
      'https://www.youtube.com/feeds/videos.xml?channel_id=UC2bZgihqibFD_vhaYEXQZFg',
    );
    expect(result).toMatchObject({
      type: 'youtube',
      feedUrl: 'https://www.youtube.com/feeds/videos.xml?channel_id=UC2bZgihqibFD_vhaYEXQZFg',
    });
  });

  it('classifies a raw Instagram profile URL, keeping the profile as identity and feedUrl null', () => {
    const result = classifyDeterministic('https://www.instagram.com/kenya20hz/');
    expect(result).toEqual({
      type: 'instagram',
      identityUrl: 'https://www.instagram.com/kenya20hz/',
      feedUrl: null,
      title: 'kenya20hz',
    });
  });

  it('classifies a raw TikTok profile URL', () => {
    const result = classifyDeterministic('https://www.tiktok.com/@popline');
    expect(result).toEqual({
      type: 'tiktok',
      identityUrl: 'https://www.tiktok.com/@popline/',
      feedUrl: null,
      title: 'popline',
    });
  });

  it('classifies a Reddit subreddit URL to its .rss feed', () => {
    const result = classifyDeterministic('https://www.reddit.com/r/witch_house/');
    expect(result).toMatchObject({ type: 'reddit', feedUrl: 'https://www.reddit.com/r/witch_house/.rss' });
  });

  it('returns null for a generic bridge URL it cannot classify deterministically', () => {
    const bridgeUrl =
      'https://rssbridge.joshwho.net/?action=display&bridge=TikTokBridge&context=By+user&username=%40popline&format=Atom';
    expect(classifyDeterministic(bridgeUrl)).toBeNull();
  });
});

function fakeHttp(responses: Record<string, { status: number; body: string; contentType?: string }>): HttpClient {
  return {
    async getText(url: string) {
      const res = responses[url];
      if (!res) return { status: 404, body: '', contentType: null };
      return { status: res.status, body: res.body, contentType: res.contentType ?? null };
    },
  };
}

describe('resolveSource', () => {
  it('resolves a YouTube @handle by fetching the channel page for its channelId, then the feed for its title', async () => {
    const http = fakeHttp({
      'https://www.youtube.com/@InstitutoConhecimentoLiberta': {
        status: 200,
        body: '<html><script>var x = {"channelId":"UCaIqJHHo9TJiLINzOFJRl2Q"};</script></html>',
      },
      'https://www.youtube.com/feeds/videos.xml?channel_id=UCaIqJHHo9TJiLINzOFJRl2Q': {
        status: 200,
        body: '<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Instituto Conhecimento Liberta</title></feed>',
      },
    });
    const result = await resolveSource('https://www.youtube.com/@InstitutoConhecimentoLiberta', http);
    expect(result).toEqual({
      kind: 'resolved',
      source: {
        type: 'youtube',
        identityUrl: 'https://www.youtube.com/channel/UCaIqJHHo9TJiLINzOFJRl2Q',
        feedUrl: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCaIqJHHo9TJiLINzOFJRl2Q',
        title: 'Instituto Conhecimento Liberta',
      },
    });
  });

  it('fetches the channel name immediately for a pasted YouTube channel URL too (not just @handles)', async () => {
    const http = fakeHttp({
      'https://www.youtube.com/feeds/videos.xml?channel_id=UC2bZgihqibFD_vhaYEXQZFg': {
        status: 200,
        body: '<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Galãs Feios</title></feed>',
      },
    });
    const result = await resolveSource(
      'https://www.youtube.com/channel/UC2bZgihqibFD_vhaYEXQZFg',
      http,
    );
    expect(result).toEqual({
      kind: 'resolved',
      source: {
        type: 'youtube',
        identityUrl: 'https://www.youtube.com/channel/UC2bZgihqibFD_vhaYEXQZFg',
        feedUrl: 'https://www.youtube.com/feeds/videos.xml?channel_id=UC2bZgihqibFD_vhaYEXQZFg',
        title: 'Galãs Feios',
      },
    });
  });

  it('accepts a URL that is already a feed', async () => {
    const http = fakeHttp({
      'https://example.com/rss2.xml': {
        status: 200,
        body: '<?xml version="1.0"?><rss version="2.0"><channel><title>X</title></channel></rss>',
      },
    });
    const result = await resolveSource('https://example.com/rss2.xml', http);
    expect(result).toEqual({
      kind: 'resolved',
      source: {
        type: 'rss',
        identityUrl: 'https://example.com/rss2.xml',
        feedUrl: 'https://example.com/rss2.xml',
        title: 'X',
      },
    });
  });

  it('discovers a single feed link from a site header', async () => {
    const http = fakeHttp({
      'https://blog.example.com/': {
        status: 200,
        body: '<html><head><link rel="alternate" type="application/rss+xml" title="Blog" href="/feed.xml"></head></html>',
      },
    });
    const result = await resolveSource('https://blog.example.com/', http);
    expect(result).toEqual({
      kind: 'resolved',
      source: {
        type: 'rss',
        identityUrl: 'https://blog.example.com/feed.xml',
        feedUrl: 'https://blog.example.com/feed.xml',
        siteUrl: 'https://blog.example.com/',
      },
    });
  });

  it('returns a choice when multiple feed links are discovered', async () => {
    const http = fakeHttp({
      'https://news.example.com/': {
        status: 200,
        body:
          '<html><head>' +
          '<link rel="alternate" type="application/rss+xml" title="All" href="/all.xml">' +
          '<link rel="alternate" type="application/atom+xml" title="Comments" href="/comments.xml">' +
          '</head></html>',
      },
    });
    const result = await resolveSource('https://news.example.com/', http);
    expect(result.kind).toBe('choice');
    if (result.kind === 'choice') {
      expect(result.candidates).toHaveLength(2);
    }
  });

  it('falls back to conventional feed paths when no <link> is present', async () => {
    const http = fakeHttp({
      'https://plain.example.com/': { status: 200, body: '<html><head></head><body>no links here</body></html>' },
      'https://plain.example.com/feed': {
        status: 200,
        body: '<?xml version="1.0"?><rss version="2.0"><channel><title>Plain</title></channel></rss>',
      },
    });
    const result = await resolveSource('https://plain.example.com/', http);
    expect(result).toEqual({
      kind: 'resolved',
      source: {
        type: 'rss',
        identityUrl: 'https://plain.example.com/feed',
        feedUrl: 'https://plain.example.com/feed',
        siteUrl: 'https://plain.example.com/',
        title: 'Plain',
      },
    });
  });

  it('returns unresolved when nothing works', async () => {
    const http = fakeHttp({
      'https://dead.example.com/': { status: 200, body: '<html></html>' },
    });
    const result = await resolveSource('https://dead.example.com/', http);
    expect(result).toEqual({ kind: 'unresolved', reason: 'no_feed_found' });
  });
});
