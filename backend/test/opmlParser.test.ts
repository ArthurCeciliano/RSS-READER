import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseOpml } from '../src/modules/opml/opmlParser.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const sample = readFileSync(path.join(dir, 'fixtures/feedbro-sample.opml'), 'utf-8');
const full = readFileSync(path.join(dir, 'fixtures/feedbro-full.opml'), 'utf-8');

describe('parseOpml', () => {
  it('parses folders and their sources', () => {
    const tree = parseOpml(sample);
    expect(tree.folders.length).toBeGreaterThan(0);
    const brNews = tree.folders.find((f) => f.name === 'BR NEWS');
    expect(brNews).toBeDefined();
    expect(brNews!.sources.length).toBe(7);
  });

  it('decodes HTML entities in titles (&#62; &#38;)', () => {
    const tree = parseOpml(sample);
    const brNews = tree.folders.find((f) => f.name === 'BR NEWS')!;
    const g1PopArte = brNews.sources.find((s) => s.xmlUrl.includes('pop-arte'));
    expect(g1PopArte?.title).toBe('g1 > Pop & Arte');
  });

  it('keeps empty folders (no children) with zero sources', () => {
    const tree = parseOpml(sample);
    const tiktokArtists = tree.folders.find((f) => f.name === 'TIKTOK ARTISTS');
    expect(tiktokArtists).toBeDefined();
    expect(tiktokArtists!.sources).toEqual([]);
  });

  it('preserves raw Instagram/TikTok profile URLs as xmlUrl (module 4)', () => {
    const tree = parseOpml(sample);
    const igFolder = tree.folders.find((f) => f.name === 'IG - MUSIC ARTISTS')!;
    const kenya = igFolder.sources.find((s) => s.title.startsWith('KENYA20HZ'));
    expect(kenya?.xmlUrl).toBe('https://www.instagram.com/kenya20hz/');
  });

  it('parses the full real-world 277-source / 43-folder export', () => {
    const tree = parseOpml(full);
    expect(tree.folders.length).toBe(43);
    const totalSources = tree.folders.reduce((sum, f) => sum + f.sources.length, 0);
    expect(totalSources).toBe(277);
  });
});
