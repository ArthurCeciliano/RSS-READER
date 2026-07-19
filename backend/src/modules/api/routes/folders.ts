import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../db/prisma.js';

export async function foldersRoutes(app: FastifyInstance) {
  app.get('/api/folders', async () => {
    const [folders, sources, unreadGroups] = await Promise.all([
      prisma.folder.findMany({ orderBy: { sortOrder: 'asc' } }),
      prisma.source.findMany({ orderBy: { sortOrder: 'asc' } }),
      prisma.item.groupBy({ by: ['sourceId'], where: { isRead: false }, _count: { _all: true } }),
    ]);

    const unreadBySource = new Map(unreadGroups.map((g) => [g.sourceId, g._count._all]));

    const sourcesByFolder = new Map<string | null, typeof sources>();
    for (const source of sources) {
      const key = source.folderId;
      if (!sourcesByFolder.has(key)) sourcesByFolder.set(key, []);
      sourcesByFolder.get(key)!.push(source);
    }

    const tree = folders.map((folder) => {
      const folderSources = (sourcesByFolder.get(folder.id) ?? []).map((s) => ({
        id: s.id,
        title: s.title,
        type: s.type,
        faviconUrl: s.faviconUrl,
        status: s.status,
        sortOrder: s.sortOrder,
        unreadCount: unreadBySource.get(s.id) ?? 0,
        identityUrl: s.identityUrl,
        hasActiveStory: s.hasActiveStory,
      }));
      return {
        id: folder.id,
        name: folder.name,
        sortOrder: folder.sortOrder,
        sources: folderSources,
        unreadCount: folderSources.reduce((sum, s) => sum + s.unreadCount, 0),
      };
    });

    return { folders: tree };
  });

  app.post<{ Body: { name: string; sortOrder?: number } }>('/api/folders', async (req, reply) => {
    const { name, sortOrder } = req.body;
    const folder = await prisma.folder.create({ data: { name, sortOrder: sortOrder ?? 0 } });
    return reply.code(201).send(folder);
  });

  app.patch<{ Params: { id: string }; Body: { name?: string; sortOrder?: number } }>(
    '/api/folders/:id',
    async (req) => {
      return prisma.folder.update({ where: { id: req.params.id }, data: req.body });
    },
  );

  app.delete<{ Params: { id: string } }>('/api/folders/:id', async (req, reply) => {
    await prisma.folder.delete({ where: { id: req.params.id } });
    return reply.code(204).send();
  });
}
