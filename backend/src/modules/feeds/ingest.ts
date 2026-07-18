import type { PrismaClient, Source } from '@prisma/client';
import type { Redis } from 'ioredis';
import { fetchFeed } from './fetcher.js';
import { parseFeedXml, type ParsedFeedItem } from './feedParser.js';
import { computeDedupeHash } from './dedupe.js';
import { computeAdaptiveIntervalMinutes, computeNextFetchAt, applyJitter } from '../queue/scheduler.js';
import { withDomainLock, DomainBusyError } from '../queue/domainLock.js';
import { buildBridgeCandidateUrls } from '../sources/bridgeResolver.js';
import { extractInstagramUsername } from '../sources/instagramUsername.js';
import { collectActionsForContext, type RuleContext } from '../rules/ruleEngine.js';
import { applyActionsToItem } from '../rules/applyRules.js';
import { env } from '../../config/env.js';

export interface IngestDeps {
  prisma: PrismaClient;
  redis: Redis;
  now?: () => Date;
  random?: () => number;
}

export interface IngestResult {
  sourceId: string;
  outcome: 'updated' | 'not_modified' | 'failed' | 'busy_retry';
  newItemCount: number;
}

function candidateFeedUrls(source: Source): string[] {
  if (source.type === 'instagram') {
    const username = extractInstagramUsername(source.identityUrl);
    return buildBridgeCandidateUrls(username, {
      instances: env.instagramBridgeInstances,
      routeTemplate: env.instagramBridgeRoute,
    });
  }
  if (source.type === 'tiktok') {
    const username = new URL(source.identityUrl).pathname.replace(/^\/|@|\/$/g, '');
    return buildBridgeCandidateUrls(username, {
      instances: env.tiktokBridgeInstances,
      routeTemplate: env.tiktokBridgeRoute,
    });
  }
  return [source.feedUrl ?? source.identityUrl];
}

function statusForFails(consecutiveFails: number): 'ok' | 'degraded' | 'failing' {
  if (consecutiveFails <= 0) return 'ok';
  if (consecutiveFails <= 2) return 'degraded';
  return 'failing';
}

function isBridgeType(type: string): boolean {
  return type === 'instagram' || type === 'tiktok';
}

/**
 * Sources created by pasting a bare channel/profile URL (module 1) or an OPML
 * entry that only had Feedbro's generic "RSS" placeholder never get a real
 * display name. Once we've actually fetched the feed, its own <title> is the
 * best name available, so backfill it — but don't clobber a name the user (or
 * a well-formed OPML) already set on purpose.
 */
function looksLikePlaceholderTitle(source: Source): boolean {
  return !source.title || source.title === source.identityUrl || source.title === 'RSS';
}

async function fetchWithTimeout(url: string, state: { etag?: string | null; lastModified?: string | null }, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFeed(url, state);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Processes a single source end-to-end: resolve which URL to hit (with
 * bridge failover for instagram/tiktok), fetch conditionally, parse, dedupe
 * + persist new items, enforce retention, and reschedule. A bridge or
 * network failure never touches previously ingested items — module 1's
 * "falha nunca apaga itens já ingeridos" guarantee lives here.
 */
export async function ingestSource(source: Source, deps: IngestDeps): Promise<IngestResult> {
  const now = deps.now ?? (() => new Date());
  const random = deps.random ? deps.random() : Math.random();
  const candidates = candidateFeedUrls(source);

  let lastError: string | null = null;
  for (const url of candidates) {
    try {
      const result = await withDomainLock(deps.redis, url, env.domainLockTtlMs, () =>
        fetchWithTimeout(url, { etag: source.etag, lastModified: source.lastModified }, env.feedLoadTimeoutMs),
      );

      if (result.notModified) {
        await deps.prisma.source.update({
          where: { id: source.id },
          data: {
            lastFetchedAt: now(),
            consecutiveFails: 0,
            status: 'ok',
            lastError: null,
            nextFetchAt: computeNextFetchAt(now(), source.scanIntervalMinutes, 0),
          },
        });
        return { sourceId: source.id, outcome: 'not_modified', newItemCount: 0 };
      }

      if (result.status < 200 || result.status >= 300 || result.body === null) {
        lastError = `HTTP ${result.status}`;
        continue;
      }

      const feed = await parseFeedXml(result.body);
      const { newItemCount } = await finalizeSuccessfulIngest(deps.prisma, source, feed.items, {
        feedTitle: feed.title,
        extraSourceFields: { etag: result.etag, lastModified: result.lastModified },
        now,
      });
      return { sourceId: source.id, outcome: 'updated', newItemCount };
    } catch (err) {
      if (err instanceof DomainBusyError) {
        const retryMs = applyJitter(2_000, 0.5, random);
        await deps.prisma.source.update({
          where: { id: source.id },
          data: { nextFetchAt: new Date(now().getTime() + retryMs) },
        });
        return { sourceId: source.id, outcome: 'busy_retry', newItemCount: 0 };
      }
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  const consecutiveFails = source.consecutiveFails + 1;
  await deps.prisma.source.update({
    where: { id: source.id },
    data: {
      lastFetchedAt: now(),
      consecutiveFails,
      status: statusForFails(consecutiveFails),
      lastError,
      nextFetchAt: computeNextFetchAt(now(), source.scanIntervalMinutes, consecutiveFails),
    },
  });
  return { sourceId: source.id, outcome: 'failed', newItemCount: 0 };
}

export interface FinalizeIngestOptions {
  /** Only used by the RSS/bridge fetch path to backfill a placeholder title from the parsed feed's <title>. */
  feedTitle?: string;
  /** Fetch-path-only fields (etag/lastModified) that don't apply to the extension-push path. */
  extraSourceFields?: Partial<{ etag: string | null; lastModified: string | null }>;
  now?: () => Date;
}

export interface FinalizeIngestResult {
  newItemCount: number;
}

/**
 * Shared "successful ingest" bookkeeping: dedupe + persist items (firing
 * rules only for genuinely new ones), enforce retention, optionally backfill
 * a placeholder title, and reschedule health/backoff fields. Used by both the
 * BullMQ fetch path (ingestSource, above) and the extension-push path (POST
 * /api/extension/instagram/:sourceId/items) so storage/dedup/rule-firing/
 * retention/rescheduling logic never drifts between entry points.
 */
export async function finalizeSuccessfulIngest(
  prisma: PrismaClient,
  source: Source,
  items: ParsedFeedItem[],
  opts?: FinalizeIngestOptions,
): Promise<FinalizeIngestResult> {
  const now = opts?.now ?? (() => new Date());
  const newItemCount = await persistItems(prisma, source, items);
  await enforceRetention(prisma, source);

  const recentDates = items
    .map((i) => i.publishedAt)
    .filter((d): d is Date => d instanceof Date)
    .sort((a, b) => b.getTime() - a.getTime());
  const intervalOptions = isBridgeType(source.type)
    ? { minMinutes: env.minScanIntervalMinutesBridge, maxMinutes: env.maxScanIntervalMinutes, defaultMinutes: source.scanIntervalMinutes }
    : { minMinutes: env.minScanIntervalMinutesNative, maxMinutes: env.maxScanIntervalMinutes, defaultMinutes: source.scanIntervalMinutes };
  const adaptiveMinutes = computeAdaptiveIntervalMinutes(recentDates, intervalOptions);

  await prisma.source.update({
    where: { id: source.id },
    data: {
      ...opts?.extraSourceFields,
      lastFetchedAt: now(),
      lastSuccessAt: now(),
      consecutiveFails: 0,
      status: 'ok',
      lastError: null,
      scanIntervalMinutes: adaptiveMinutes,
      nextFetchAt: computeNextFetchAt(now(), adaptiveMinutes, 0),
      ...(opts?.feedTitle && looksLikePlaceholderTitle(source) ? { title: opts.feedTitle } : {}),
    },
  });
  return { newItemCount };
}

async function persistItems(prisma: PrismaClient, source: Source, items: ParsedFeedItem[]): Promise<number> {
  let created = 0;
  // Fetched once per source, not per item: rules (module 3's SE/ENTAO engine) only
  // fire for genuinely new items, never re-applied to items refreshed on re-fetch,
  // so a manual "unstar" or "mark unread" isn't silently undone next cycle.
  const rules = await prisma.rule.findMany({ where: { enabled: true } });
  const folder = source.folderId
    ? await prisma.folder.findUnique({ where: { id: source.folderId }, select: { name: true } })
    : null;

  for (const item of items) {
    const dedupeHash = computeDedupeHash({ guid: item.guid, link: item.link, title: item.title, publishedAt: item.publishedAt });
    const existing = await prisma.item.findUnique({
      where: { sourceId_dedupeHash: { sourceId: source.id, dedupeHash } },
      select: { id: true },
    });
    const fields = {
      link: item.link,
      title: item.title,
      summary: item.summary,
      contentHtml: item.contentHtml,
      imageUrl: item.imageUrl,
      author: item.author,
      publishedAt: item.publishedAt,
    };
    if (existing) {
      // Refresh metadata on re-fetch (e.g. a parser fix backfilling a thumbnail
      // that was missing before) without touching user state like isRead/isStarred.
      await prisma.item.update({ where: { id: existing.id }, data: fields });
      continue;
    }
    const createdItem = await prisma.item.create({ data: { sourceId: source.id, guid: item.guid, dedupeHash, ...fields } });
    created += 1;

    if (rules.length > 0) {
      const ctx: RuleContext = {
        sourceTitle: source.title,
        folderName: folder?.name ?? null,
        title: item.title,
        content: `${item.summary ?? ''} ${item.contentHtml ?? ''}`,
      };
      const actions = collectActionsForContext(rules, ctx);
      await applyActionsToItem(prisma, createdItem.id, actions);
    }
  }
  return created;
}

/** Deletes oldest non-starred items beyond the source's retention cap; starred items are never removed. */
async function enforceRetention(prisma: PrismaClient, source: Source): Promise<void> {
  const keepIds = await prisma.item.findMany({
    where: { sourceId: source.id },
    orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
    take: source.maxEntries,
    select: { id: true },
  });
  const keepIdSet = new Set(keepIds.map((i) => i.id));
  await prisma.item.deleteMany({
    where: {
      sourceId: source.id,
      isStarred: false,
      id: { notIn: Array.from(keepIdSet) },
    },
  });
}
