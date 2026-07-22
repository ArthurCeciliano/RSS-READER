import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../db/prisma.js';
import { computeInstagramStats } from '../../instagram/readStats.js';

interface StatsQuery {
  days?: string;
}

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function statsRoutes(app: FastifyInstance) {
  app.get<{ Querystring: StatsQuery }>('/api/stats', async (req) => {
    const days = Math.min(180, Math.max(1, Number.parseInt(req.query.days ?? '30', 10) || 30));
    const since = new Date(Date.now() - days * 86_400_000);

    const [itemsInRange, totalCount, readCount, starredCount, sourceCount, folderCount] = await Promise.all([
      prisma.item.findMany({
        where: { createdAt: { gte: since } },
        select: { createdAt: true, sourceId: true },
      }),
      prisma.item.count(),
      prisma.item.count({ where: { isRead: true } }),
      prisma.item.count({ where: { isStarred: true } }),
      prisma.source.count(),
      prisma.folder.count(),
    ]);

    const perDay = new Map<string, number>();
    for (let i = 0; i < days; i++) {
      perDay.set(dateKey(new Date(Date.now() - i * 86_400_000)), 0);
    }
    const countBySource = new Map<string, number>();
    for (const item of itemsInRange) {
      const key = dateKey(item.createdAt);
      if (perDay.has(key)) perDay.set(key, (perDay.get(key) ?? 0) + 1);
      countBySource.set(item.sourceId, (countBySource.get(item.sourceId) ?? 0) + 1);
    }
    const itemsPerDay = Array.from(perDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }));

    const topSourceIds = Array.from(countBySource.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    const sources = await prisma.source.findMany({
      where: { id: { in: topSourceIds.map(([id]) => id) } },
      select: { id: true, title: true },
    });
    const titleById = new Map(sources.map((s) => [s.id, s.title]));
    const topSources = topSourceIds.map(([sourceId, count]) => ({
      sourceId,
      title: titleById.get(sourceId) ?? sourceId,
      count,
    }));

    return {
      days,
      itemsPerDay,
      topSources,
      readRate: { read: readCount, unread: totalCount - readCount, total: totalCount },
      starredCount,
      sourceCount,
      folderCount,
    };
  });

  app.get('/api/stats/instagram', async () => computeInstagramStats(prisma));
}
