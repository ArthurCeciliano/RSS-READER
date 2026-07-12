import { describe, expect, it } from 'vitest';
import {
  buildRedditFeedUrl,
  extractInstagramUsername,
  extractTikTokUsername,
  extractYouTubeChannelId,
  extractYouTubeHandle,
  extractYouTubePlaylistId,
  isRedditUrl,
  normalizeIdentityUrl,
} from '../src/modules/sources/urlNormalizer.js';

describe('extractInstagramUsername', () => {
  it('extracts username from a profile URL', () => {
    expect(extractInstagramUsername('https://www.instagram.com/kenya20hz/')).toBe('kenya20hz');
    expect(extractInstagramUsername('https://www.instagram.com/kenya20hz')).toBe('kenya20hz');
  });
  it('ignores reserved path segments', () => {
    expect(extractInstagramUsername('https://www.instagram.com/p/abc123/')).toBeNull();
  });
  it('returns null for non-instagram hosts', () => {
    expect(extractInstagramUsername('https://example.com/kenya20hz/')).toBeNull();
  });
});

describe('extractTikTokUsername', () => {
  it('extracts @handle from a profile URL', () => {
    expect(extractTikTokUsername('https://www.tiktok.com/@popline')).toBe('popline');
  });
  it('returns null when there is no @handle segment', () => {
    expect(extractTikTokUsername('https://www.tiktok.com/foryou')).toBeNull();
  });
});

describe('YouTube URL extraction', () => {
  it('extracts channel_id from a feed URL', () => {
    expect(
      extractYouTubeChannelId('https://www.youtube.com/feeds/videos.xml?channel_id=UC2bZgihqibFD_vhaYEXQZFg'),
    ).toBe('UC2bZgihqibFD_vhaYEXQZFg');
  });
  it('extracts channel id from a /channel/ URL', () => {
    expect(extractYouTubeChannelId('https://www.youtube.com/channel/UCabc123')).toBe('UCabc123');
  });
  it('extracts playlist_id from a feed URL', () => {
    expect(
      extractYouTubePlaylistId('https://www.youtube.com/feeds/videos.xml?playlist_id=PLkJSvVwhjVMN8sV2FHxAEMWz3xOF2GdEU'),
    ).toBe('PLkJSvVwhjVMN8sV2FHxAEMWz3xOF2GdEU');
  });
  it('extracts @handle references', () => {
    expect(extractYouTubeHandle('https://www.youtube.com/@InstitutoConhecimentoLiberta')).toEqual({
      kind: 'handle',
      value: 'InstitutoConhecimentoLiberta',
    });
  });
  it('extracts /user/ and /c/ references', () => {
    expect(extractYouTubeHandle('https://www.youtube.com/user/someuser')).toEqual({
      kind: 'user',
      value: 'someuser',
    });
    expect(extractYouTubeHandle('https://www.youtube.com/c/somechannel')).toEqual({
      kind: 'c',
      value: 'somechannel',
    });
  });
});

describe('reddit helpers', () => {
  it('detects reddit URLs', () => {
    expect(isRedditUrl('https://www.reddit.com/r/witch_house/')).toBe(true);
    expect(isRedditUrl('https://example.com')).toBe(false);
  });
  it('builds the .rss feed URL without doubling it', () => {
    expect(buildRedditFeedUrl('https://www.reddit.com/r/witch_house/')).toBe(
      'https://www.reddit.com/r/witch_house/.rss',
    );
    expect(buildRedditFeedUrl('https://www.reddit.com/r/witch_house/.rss')).toBe(
      'https://www.reddit.com/r/witch_house/.rss',
    );
  });
});

describe('normalizeIdentityUrl', () => {
  it('lower-cases the hostname and strips the fragment', () => {
    expect(normalizeIdentityUrl('https://WWW.Example.com/path#frag')).toBe('https://www.example.com/path');
  });
  it('preserves query strings verbatim (they may be the resource identity)', () => {
    const bridgeUrl =
      'https://rssbridge.joshwho.net/?action=display&bridge=TikTokBridge&context=By+user&username=%40popline&format=Atom';
    expect(normalizeIdentityUrl(bridgeUrl)).toBe(bridgeUrl);
  });
  it('strips a single trailing slash', () => {
    expect(normalizeIdentityUrl('https://www.instagram.com/kenya20hz/')).toBe(
      'https://www.instagram.com/kenya20hz',
    );
  });
});
