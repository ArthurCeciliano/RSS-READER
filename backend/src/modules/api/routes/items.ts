import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../db/prisma.js';
import type { Prisma } from '@prisma/client';

interface ListQuery {
  folderId?: string;
  sourceId?: string;
  filter?: 'all' | 'unread' | 'starred';
  sort?: 'newest' | 'oldest';
  maxAgeDays?: string;
  cursor?: string;
  limit?: string;
}

export async function itemsRoutes(app: FastifyInstance) {
  app.get<{ Querystring: ListQuery }>('/api/items', async (req) => {
    const { folderId, sourceId, filter = 'all', sort = 'newest', maxAgeDays, cursor, limit } = req.query;
    const take = Math.min(100, Number.parseInt(limit ?? '30', 10) || 30);

    const where: Prisma.ItemWhereInput = {};
    if (sourceId) where.sourceId = sourceId;
    if (folderId) where.source = { folderId };
    if (filter === 'unread') where.isRead = false;
    if (filter === 'starred') where.isStarred = true;
    if (maxAgeDays) {
      const days = Number.parseInt(maxAgeDays, 10);
      if (Number.isFinite(days)) {
        where.publishedAt = { gte: new Date(Date.now() - days * 86_400_000) };
      }
    }

    const items = await prisma.item.findMany({
      where,
      include: { source: { select: { title: true, faviconUrl: true, siteUrl: true, type: true } } },
      orderBy: { publishedAt: sort === 'oldest' ? 'asc' : 'desc' },
      take: take + 1,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    const hasMore = items.length > take;
    const page = hasMore ? items.slice(0, take) : items;
    return { items: page, nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null };
  });

  app.patch<{ Params: { id: string }; Body: { isRead?: boolean; isStarred?: boolean } }>(
    '/api/items/:id',
    async (req) => {
      return prisma.item.update({ where: { id: req.params.id }, data: req.body });
    },
  );

  app.post<{ Body: { folderId?: string; sourceId?: string } }>('/api/items/mark-all-read', async (req) => {
    const where: Prisma.ItemWhereInput = {};
    if (req.body.sourceId) where.sourceId = req.body.sourceId;
    else if (req.body.folderId) where.source = { folderId: req.body.folderId };

    const result = await prisma.item.updateMany({ where, data: { isRead: true } });
    return { updated: result.count };
  });
}
