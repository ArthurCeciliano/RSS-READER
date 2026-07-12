import { describe, expect, it } from 'vitest';
import { parseFeedXml } from '../src/modules/feeds/feedParser.js';

const rss2 = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Example Feed</title>
    <item>
      <title>First post</title>
      <link>https://example.com/first</link>
      <guid>urn:uuid:1234</guid>
      <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
      <description>A short summary</description>
      <content:encoded xmlns:content="http://purl.org/rss/1.0/modules/content/"><![CDATA[<p>Body <img src="https://example.com/img1.jpg"></p>]]></content:encoded>
    </item>
    <item>
      <title>Second post (no guid)</title>
      <link>https://example.com/second</link>
      <pubDate>Tue, 02 Jan 2024 00:00:00 GMT</pubDate>
      <description>Another summary</description>
    </item>
  </channel>
</rss>`;

const atom = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Feed</title>
  <entry>
    <title>Atom entry</title>
    <link href="https://example.com/atom-entry"/>
    <id>tag:example.com,2024:atom-entry</id>
    <updated>2024-01-03T00:00:00Z</updated>
    <summary>Atom summary</summary>
  </entry>
</feed>`;

// Mirrors the real structure returned by youtube.com/feeds/videos.xml — thumbnail
// and description live inside <media:group>, not as direct entry children.
const youtubeAtom = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
  <title>Some Channel</title>
  <entry>
    <id>yt:video:ABC123</id>
    <title>A Great Video</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=ABC123"/>
    <published>2024-02-01T00:00:00+00:00</published>
    <media:group>
      <media:title>A Great Video</media:title>
      <media:content url="https://www.youtube.com/v/ABC123?version=3" type="application/x-shockwave-flash" width="640" height="390"/>
      <media:thumbnail url="https://i.ytimg.com/vi/ABC123/hqdefault.jpg" width="480" height="360"/>
      <media:description>The real video description goes here.</media:description>
    </media:group>
  </entry>
</feed>`;

describe('parseFeedXml', () => {
  it('parses RSS 2.0 items with guid, link, image extraction from content:encoded', async () => {
    const feed = await parseFeedXml(rss2);
    expect(feed.title).toBe('Example Feed');
    expect(feed.items).toHaveLength(2);
    expect(feed.items[0]).toMatchObject({
      guid: 'urn:uuid:1234',
      link: 'https://example.com/first',
      title: 'First post',
      imageUrl: 'https://example.com/img1.jpg',
    });
    expect(feed.items[0].publishedAt?.toISOString()).toBe('2024-01-01T00:00:00.000Z');
  });

  it('falls back gracefully when an item has no guid', async () => {
    const feed = await parseFeedXml(rss2);
    expect(feed.items[1].guid).toBeUndefined();
    expect(feed.items[1].link).toBe('https://example.com/second');
  });

  it('parses Atom feeds', async () => {
    const feed = await parseFeedXml(atom);
    expect(feed.title).toBe('Atom Feed');
    expect(feed.items[0]).toMatchObject({
      link: 'https://example.com/atom-entry',
      title: 'Atom entry',
    });
  });

  it('extracts thumbnail and description nested inside <media:group> (YouTube feeds)', async () => {
    const feed = await parseFeedXml(youtubeAtom);
    expect(feed.title).toBe('Some Channel');
    expect(feed.items[0]).toMatchObject({
      title: 'A Great Video',
      link: 'https://www.youtube.com/watch?v=ABC123',
      imageUrl: 'https://i.ytimg.com/vi/ABC123/hqdefault.jpg',
      summary: 'The real video description goes here.',
    });
  });
});
