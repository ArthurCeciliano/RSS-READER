import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../db/prisma.js';
import type { Prisma } from '@prisma/client';

interface ListQuery {
  folderId?: string;
  sourceId?: string;
  tagId?: string;
  filter?: 'all' | 'unread' | 'starred';
  sort?: 'newest' | 'oldest';
  maxAgeDays?: string;
  cursor?: string;
  limit?: string;
}

export async function itemsRoutes(app: FastifyInstance) {
  app.get<{ Querystring: ListQuery }>('/api/items', async (req) => {
    const { folderId, sourceId, tagId, filter = 'all', sort = 'newest', maxAgeDays, cursor, limit } = req.query;
    const take = Math.min(100, Number.parseInt(limit ?? '30', 10) || 30);

    const where: Prisma.ItemWhereInput = {};
    if (sourceId) where.sourceId = sourceId;
    if (folderId) where.source = { folderId };
    if (tagId) where.tags = { some: { tagId } };
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

  app.get<{ Querystring: { q?: string; limit?: string } }>('/api/items/search', async (req) => {
    const q = req.query.q?.trim();
    if (!q) return { items: [] };
    const limit = Math.min(50, Number.parseInt(req.query.limit ?? '30', 10) || 30);

    // searchVector is a generated tsvector column (title+summary) Prisma can't model
    // as a queryable field (module 3) -- ranked ids come from raw SQL, then a normal
    // findMany hydrates full rows (incl. the source join) in that rank order.
    const ranked = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Item"
      WHERE "searchVector" @@ plainto_tsquery('simple', ${q})
      ORDER BY ts_rank("searchVector", plainto_tsquery('simple', ${q})) DESC
      LIMIT ${limit}
    `;
    const ids = ranked.map((r) => r.id);
    if (ids.length === 0) return { items: [] };

    const items = await prisma.item.findMany({
      where: { id: { in: ids } },
      include: { source: { select: { title: true, faviconUrl: true, siteUrl: true, type: true } } },
    });
    const order = new Map(ids.map((id, i) => [id, i]));
    items.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

    return { items };
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

  // Polled by the frontend (module 3: notify_desktop/play_sound rule actions) --
  // desktop Notifications and audio can only fire from the browser, so the
  // backend just surfaces which items a matching rule flagged, and the
  // frontend acks each one back to clear the flag once shown/played.
  app.get('/api/items/pending-notifications', async () => {
    const items = await prisma.item.findMany({
      where: { OR: [{ pendingDesktopNotify: true }, { pendingSound: true }] },
      select: {
        id: true,
        title: true,
        pendingDesktopNotify: true,
        pendingSound: true,
        source: { select: { title: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });
    return { items };
  });

  app.post<{ Params: { id: string } }>('/api/items/:id/ack-notification', async (req, reply) => {
    await prisma.item.update({
      where: { id: req.params.id },
      data: { pendingDesktopNotify: false, pendingSound: false },
    });
    return reply.code(204).send();
  });
}
