import { describe, expect, it } from 'vitest';
import { buildBridgeCandidateUrls } from '../src/modules/sources/bridgeResolver.js';

describe('buildBridgeCandidateUrls', () => {
  it('expands the username into every configured instance, in order', () => {
    const urls = buildBridgeCandidateUrls('kenya20hz', {
      instances: ['http://rsshub:1200', 'https://rsshub.fallback.example'],
      routeTemplate: '/picnob/user/:username',
    });
    expect(urls).toEqual([
      'http://rsshub:1200/picnob/user/kenya20hz',
      'https://rsshub.fallback.example/picnob/user/kenya20hz',
    ]);
  });

  it('strips a trailing slash from instance base URLs', () => {
    const urls = buildBridgeCandidateUrls('popline', {
      instances: ['http://rsshub:1200/'],
      routeTemplate: '/tiktok/user/@:username',
    });
    expect(urls).toEqual(['http://rsshub:1200/tiktok/user/@popline']);
  });
});
