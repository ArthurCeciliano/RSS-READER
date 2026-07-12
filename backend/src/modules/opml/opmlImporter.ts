import type { OpmlFolder, OpmlSourceEntry, OpmlTree } from './opmlParser.js';
import { classifyDeterministic, type ResolvedSourceType } from '../sources/sourceResolver.js';
import { normalizeIdentityUrl } from '../sources/urlNormalizer.js';

export interface PlannedSource {
  title: string;
  originalXmlUrl: string;
  originalHtmlUrl?: string;
  type: ResolvedSourceType;
  identityUrl: string;
  feedUrl: string | null;
}

export interface PlannedFolder {
  name: string;
  sources: PlannedSource[];
}

export interface ImportPlan {
  folders: PlannedFolder[];
  rootSources: PlannedSource[];
}

function mapTypeAttr(attr: string | undefined): ResolvedSourceType {
  if (!attr) return 'rss';
  const lower = attr.toLowerCase();
  if (lower === 'atom' || lower === 'rss' || lower === 'json_feed') return lower as ResolvedSourceType;
  return 'rss';
}

/**
 * Turns a parsed OPML entry into a planned source WITHOUT any network access.
 * Feedbro exports store Instagram/TikTok subscriptions as the raw profile
 * URL in xmlUrl (see module 4 spec) — classifyDeterministic recognizes those
 * by hostname and routes them to the bridge-backed types instead of trusting
 * xmlUrl as a literal feed URL. Everything else (native RSS/Atom, YouTube
 * feed URLs, Reddit, already-configured bridge URLs like RSS-Bridge/Nitter
 * links) is trusted as-is, since the OPML itself is the output of a working
 * feed reader.
 */
export function planSourceEntry(entry: OpmlSourceEntry): PlannedSource {
  const deterministic = classifyDeterministic(entry.xmlUrl);
  if (deterministic) {
    return {
      title: entry.title || entry.text,
      originalXmlUrl: entry.xmlUrl,
      originalHtmlUrl: entry.htmlUrl,
      type: deterministic.type,
      identityUrl: deterministic.identityUrl,
      feedUrl: deterministic.feedUrl,
    };
  }

  return {
    title: entry.title || entry.text,
    originalXmlUrl: entry.xmlUrl,
    originalHtmlUrl: entry.htmlUrl,
    type: mapTypeAttr(entry.type),
    identityUrl: normalizeIdentityUrl(entry.xmlUrl),
    feedUrl: entry.xmlUrl,
  };
}

export function buildImportPlan(tree: OpmlTree): ImportPlan {
  const folders: PlannedFolder[] = tree.folders.map((folder: OpmlFolder) => ({
    name: folder.name,
    sources: folder.sources.map(planSourceEntry),
  }));

  return {
    folders,
    rootSources: tree.rootSources.map(planSourceEntry),
  };
}

export interface ImportReportEntry {
  title: string;
  identityUrl: string;
  folder: string | null;
  reason?: string;
}

export interface ImportReport {
  added: ImportReportEntry[];
  skipped: ImportReportEntry[];
  failed: ImportReportEntry[];
}

export interface SourceWriter {
  /** Returns true if a source with this identityUrl already exists. */
  exists(identityUrl: string): Promise<boolean>;
  upsertFolder(name: string, sortOrder: number): Promise<string>;
  createSource(folderId: string | null, sortOrder: number, planned: PlannedSource): Promise<void>;
}

export interface ImportOptions {
  skipExisting: boolean;
  /** Invoked after each source is processed so callers can drive a progress bar. */
  onProgress?: (processed: number, total: number) => void;
}

function countPlanSources(plan: ImportPlan): number {
  return plan.rootSources.length + plan.folders.reduce((sum, f) => sum + f.sources.length, 0);
}

/**
 * Persists an import plan via the given writer (a thin Prisma adapter in
 * production, a fake in tests) and produces the added/skipped/failed report
 * required by module 4.
 */
export async function persistImportPlan(
  plan: ImportPlan,
  writer: SourceWriter,
  options: ImportOptions,
): Promise<ImportReport> {
  const report: ImportReport = { added: [], skipped: [], failed: [] };
  const total = countPlanSources(plan);
  let processed = 0;

  async function processSource(folderId: string | null, folderName: string | null, sortOrder: number, planned: PlannedSource) {
    const entry: ImportReportEntry = { title: planned.title, identityUrl: planned.identityUrl, folder: folderName };
    try {
      if (options.skipExisting && (await writer.exists(planned.identityUrl))) {
        report.skipped.push(entry);
        return;
      }
      await writer.createSource(folderId, sortOrder, planned);
      report.added.push(entry);
    } catch (err) {
      report.failed.push({ ...entry, reason: err instanceof Error ? err.message : String(err) });
    } finally {
      processed += 1;
      options.onProgress?.(processed, total);
    }
  }

  for (let i = 0; i < plan.rootSources.length; i++) {
    await processSource(null, null, i, plan.rootSources[i]);
  }

  for (let folderIdx = 0; folderIdx < plan.folders.length; folderIdx++) {
    const folder = plan.folders[folderIdx];
    const folderId = await writer.upsertFolder(folder.name, folderIdx);
    for (let i = 0; i < folder.sources.length; i++) {
      await processSource(folderId, folder.name, i, folder.sources[i]);
    }
  }

  return report;
}
