import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseOpml } from '../src/modules/opml/opmlParser.js';
import { buildImportPlan, persistImportPlan, type PlannedSource, type SourceWriter } from '../src/modules/opml/opmlImporter.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const sample = readFileSync(path.join(dir, 'fixtures/feedbro-sample.opml'), 'utf-8');
const full = readFileSync(path.join(dir, 'fixtures/feedbro-full.opml'), 'utf-8');

describe('buildImportPlan', () => {
  it('routes raw Instagram/TikTok profile URLs through the module 1 resolver instead of treating them as literal feeds', () => {
    const plan = buildImportPlan(parseOpml(sample));
    const igFolder = plan.folders.find((f) => f.name === 'IG - MUSIC ARTISTS')!;
    const kenya = igFolder.sources.find((s) => s.title.startsWith('KENYA20HZ'))!;
    expect(kenya.type).toBe('instagram');
    expect(kenya.identityUrl).toBe('https://www.instagram.com/kenya20hz/');
    expect(kenya.feedUrl).toBeNull();
  });

  it('trusts an already-configured bridge URL (e.g. RSS-Bridge TikTok) as a direct feed', () => {
    const plan = buildImportPlan(parseOpml(sample));
    const tiktokFolder = plan.folders.find((f) => f.name === 'TIKTOK POP NEWS')!;
    const popline = tiktokFolder.sources[0];
    expect(popline.feedUrl).toContain('rssbridge.joshwho.net');
  });

  it('classifies native YouTube feed URLs directly', () => {
    const plan = buildImportPlan(parseOpml(sample));
    const ytFolder = plan.folders.find((f) => f.name === 'YT- NEWS')!;
    expect(ytFolder.sources.every((s) => s.type === 'youtube')).toBe(true);
  });

  it('produces 277 planned sources across 43 folders for the full real export', () => {
    const plan = buildImportPlan(parseOpml(full));
    expect(plan.folders.length).toBe(43);
    const total = plan.folders.reduce((sum, f) => sum + f.sources.length, 0);
    expect(total).toBe(277);
  });

  it('counts source types across the full export (sanity check on the resolver)', () => {
    const plan = buildImportPlan(parseOpml(full));
    const counts: Record<string, number> = {};
    for (const folder of plan.folders) {
      for (const s of folder.sources) counts[s.type] = (counts[s.type] ?? 0) + 1;
    }
    expect(counts.instagram).toBeGreaterThan(100);
    expect(counts.youtube).toBeGreaterThan(20);
    expect(counts.reddit).toBe(1);
  });
});

function fakeWriter(existing: Set<string> = new Set()): { writer: SourceWriter; created: PlannedSource[] } {
  const created: PlannedSource[] = [];
  const writer: SourceWriter = {
    async exists(identityUrl) {
      return existing.has(identityUrl);
    },
    async upsertFolder(name) {
      return `folder:${name}`;
    },
    async createSource(_folderId, _sortOrder, planned) {
      if (planned.title === 'FAIL_ME') throw new Error('boom');
      created.push(planned);
    },
  };
  return { writer, created };
}

describe('persistImportPlan', () => {
  it('reports added sources when none exist yet', async () => {
    const plan = buildImportPlan(parseOpml(sample));
    const { writer, created } = fakeWriter();
    const report = await persistImportPlan(plan, writer, { skipExisting: true });
    expect(report.failed).toEqual([]);
    expect(report.added.length).toBeGreaterThan(0);
    expect(created.length).toBe(report.added.length);
  });

  it('skips sources whose identityUrl already exists when skipExisting is true', async () => {
    const plan = buildImportPlan(parseOpml(sample));
    const existing = new Set(['https://www.brasildefato.com.br/rss2.xml']);
    const { writer } = fakeWriter(existing);
    const report = await persistImportPlan(plan, writer, { skipExisting: true });
    expect(report.skipped.some((s) => s.identityUrl === 'https://www.brasildefato.com.br/rss2.xml')).toBe(true);
  });

  it('records failures without aborting the rest of the import', async () => {
    const plan = buildImportPlan(parseOpml(sample));
    plan.folders[0].sources[0] = { ...plan.folders[0].sources[0], title: 'FAIL_ME' };
    const { writer } = fakeWriter();
    const report = await persistImportPlan(plan, writer, { skipExisting: true });
    expect(report.failed.some((f) => f.title === 'FAIL_ME' && f.reason === 'boom')).toBe(true);
    expect(report.added.length).toBeGreaterThan(0);
  });
});
