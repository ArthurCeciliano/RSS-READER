import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../db/prisma.js';
import { resolveSource, type HttpClient, type ResolvedSource } from '../../sources/sourceResolver.js';
import { getFeedRefreshQueue } from '../../queue/queue.js';
import { enqueueManualRefresh } from '../../queue/producer.js';
import { env } from '../../../config/env.js';
import { collectFolderAndDescendantIds } from '../../folders/descendants.js';

const PRISMA_UNIQUE_CONSTRAINT = 'P2002';

function isPrismaKnownError(err: unknown, code: string): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === code;
}

const undiciHttp: HttpClient = {
  async getText(url: string) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.feedLoadTimeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'rss-reader/1.0' } });
      return { status: res.status, body: await res.text(), contentType: res.headers.get('content-type') };
    } catch {
      return { status: 0, body: '', contentType: null };
    } finally {
      clearTimeout(timer);
    }
  },
};

export async function sourcesRoutes(app: FastifyInstance) {
  app.post<{ Body: { url: string } }>('/api/sources/resolve', async (req, reply) => {
    const result = await resolveSource(req.body.url, undiciHttp);
    if (result.kind === 'unresolved') return reply.code(422).send(result);
    return result;
  });

  app.post<{
    Body: { url?: string; resolved?: ResolvedSource; folderId?: string | null; title?: string };
  }>('/api/sources', async (req, reply) => {
    // Prefer a pre-resolved payload (the "Adicionar fonte" dialog already called
    // /resolve once) so we don't re-hit the network a second time — important for
    // YouTube @handle/Instagram/TikTok, where re-resolving can transiently fail
    // even though the first resolution succeeded.
    let source: ResolvedSource;
    if (req.body.resolved) {
      source = req.body.resolved;
    } else {
      if (!req.body.url) return reply.code(400).send({ error: 'url or resolved is required' });
      const result = await resolveSource(req.body.url, undiciHttp);
      if (result.kind !== 'resolved') return reply.code(422).send(result);
      source = result.source;
    }

    const isBridge = source.type === 'instagram' || source.type === 'tiktok';
    try {
      const created = await prisma.source.create({
        data: {
          folderId: req.body.folderId ?? null,
          title: req.body.title || source.title || source.identityUrl,
          identityUrl: source.identityUrl,
          feedUrl: source.feedUrl,
          siteUrl: source.siteUrl,
          type: source.type,
          scanIntervalMinutes: isBridge ? env.minScanIntervalMinutesBridge : env.defaultScanIntervalMinutes,
          maxEntries: env.defaultMaxEntries,
          inactiveLimitDays: env.defaultInactiveLimitDays,
        },
      });
      return reply.code(201).send(created);
    } catch (err) {
      if (isPrismaKnownError(err, PRISMA_UNIQUE_CONSTRAINT)) {
        return reply.code(409).send({ error: 'Essa fonte já foi adicionada.' });
      }
      throw err;
    }
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/sources/:id', async (req) => {
    return prisma.source.update({ where: { id: req.params.id }, data: req.body });
  });

  app.delete<{ Params: { id: string } }>('/api/sources/:id', async (req, reply) => {
    await prisma.source.delete({ where: { id: req.params.id } });
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>('/api/sources/:id/refresh', async (req) => {
    const queue = getFeedRefreshQueue();
    await enqueueManualRefresh(queue, [req.params.id]);
    return { queued: true };
  });

  app.post<{ Body: { folderId?: string } }>('/api/sources/refresh-all', async (req) => {
    const folderIds = req.body.folderId ? await collectFolderAndDescendantIds(prisma, req.body.folderId) : null;
    const sources = await prisma.source.findMany({
      where: folderIds ? { folderId: { in: folderIds } } : {},
      select: { id: true },
    });
    const queue = getFeedRefreshQueue();
    await enqueueManualRefresh(queue, sources.map((s) => s.id));
    return { queued: sources.length };
  });

  app.get('/api/sources/health', async () => {
    const sources = await prisma.source.findMany({
      select: {
        id: true,
        title: true,
        type: true,
        status: true,
        lastSuccessAt: true,
        lastFetchedAt: true,
        nextFetchAt: true,
        consecutiveFails: true,
        lastError: true,
      },
      orderBy: { consecutiveFails: 'desc' },
    });
    return { sources };
  });
}
