import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseOpml } from '../src/modules/opml/opmlParser.js';
import { buildImportPlan } from '../src/modules/opml/opmlImporter.js';
import { exportOpml } from '../src/modules/opml/opmlExporter.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const sample = readFileSync(path.join(dir, 'fixtures/feedbro-sample.opml'), 'utf-8');

describe('exportOpml', () => {
  it('re-exports Instagram sources using the original profile URL, not a bridge URL', () => {
    const plan = buildImportPlan(parseOpml(sample));
    const xml = exportOpml(
      plan.folders.map((f) => ({
        name: f.name,
        sources: f.sources.map((s) => ({ title: s.title, identityUrl: s.identityUrl, feedUrl: s.feedUrl, type: s.type })),
      })),
    );
    expect(xml).toContain('xmlUrl="https://www.instagram.com/kenya20hz/"');
  });

  it('round-trips through parseOpml producing the same folder/source counts', () => {
    const plan = buildImportPlan(parseOpml(sample));
    const xml = exportOpml(
      plan.folders.map((f) => ({
        name: f.name,
        sources: f.sources.map((s) => ({ title: s.title, identityUrl: s.identityUrl, feedUrl: s.feedUrl, type: s.type })),
      })),
    );
    const reparsed = parseOpml(xml);
    expect(reparsed.folders.length).toBe(plan.folders.length);
    const originalTotal = plan.folders.reduce((sum, f) => sum + f.sources.length, 0);
    const reparsedTotal = reparsed.folders.reduce((sum, f) => sum + f.sources.length, 0);
    expect(reparsedTotal).toBe(originalTotal);
  });
});
