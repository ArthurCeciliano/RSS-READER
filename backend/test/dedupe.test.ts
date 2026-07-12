import { describe, expect, it } from 'vitest';
import { computeDedupeHash } from '../src/modules/feeds/dedupe.js';

describe('computeDedupeHash', () => {
  it('is stable across repeated calls with the same guid', () => {
    const a = computeDedupeHash({ guid: 'abc', title: 'X', link: 'https://x.com/1' });
    const b = computeDedupeHash({ guid: 'abc', title: 'different title', link: 'https://x.com/2' });
    expect(a).toBe(b);
  });

  it('falls back to link when there is no guid', () => {
    const a = computeDedupeHash({ title: 'X', link: 'https://x.com/1' });
    const b = computeDedupeHash({ title: 'different title', link: 'https://x.com/1' });
    expect(a).toBe(b);
  });

  it('falls back to title+date when neither guid nor link exist', () => {
    const date = new Date('2024-01-01T00:00:00Z');
    const a = computeDedupeHash({ title: 'Same title', publishedAt: date });
    const b = computeDedupeHash({ title: 'Same title', publishedAt: date });
    expect(a).toBe(b);
  });

  it('produces different hashes for different items', () => {
    const a = computeDedupeHash({ guid: 'abc', title: 'X' });
    const b = computeDedupeHash({ guid: 'def', title: 'X' });
    expect(a).not.toBe(b);
  });
});
