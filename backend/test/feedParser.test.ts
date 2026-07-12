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
});
