import type { FastifyInstance } from 'fastify';
import type { Source } from '@prisma/client';
import { prisma } from '../../../db/prisma.js';

interface FolderTreeNode {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  sources: ReturnType<typeof mapSource>[];
  children: FolderTreeNode[];
  unreadCount: number;
}

function mapSource(s: Source, unreadBySource: Map<string, number>) {
  return {
    id: s.id,
    title: s.title,
    type: s.type,
    faviconUrl: s.faviconUrl,
    status: s.status,
    sortOrder: s.sortOrder,
    unreadCount: unreadBySource.get(s.id) ?? 0,
    identityUrl: s.identityUrl,
    hasActiveStory: s.hasActiveStory,
    storyAcknowledged: s.storyAcknowledged,
  };
}

/** Walks parentId up from candidateParentId looking for folderId -- true if setting
 *  folderId's parent to candidateParentId would create a cycle in the folder tree. */
async function wouldCreateCycle(folderId: string, candidateParentId: string): Promise<boolean> {
  let current: string | null = candidateParentId;
  while (current) {
    if (current === folderId) return true;
    const parent: { parentId: string | null } | null = await prisma.folder.findUnique({
      where: { id: current },
      select: { parentId: true },
    });
    current = parent?.parentId ?? null;
  }
  return false;
}

export async function foldersRoutes(app: FastifyInstance) {
  app.get('/api/folders', async () => {
    const [folders, sources, unreadGroups] = await Promise.all([
      prisma.folder.findMany({ orderBy: { sortOrder: 'asc' } }),
      prisma.source.findMany({ orderBy: { sortOrder: 'asc' } }),
      prisma.item.groupBy({ by: ['sourceId'], where: { isRead: false }, _count: { _all: true } }),
    ]);

    const unreadBySource = new Map(unreadGroups.map((g) => [g.sourceId, g._count._all]));

    const sourcesByFolder = new Map<string | null, Source[]>();
    for (const source of sources) {
      const key = source.folderId;
      if (!sourcesByFolder.has(key)) sourcesByFolder.set(key, []);
      sourcesByFolder.get(key)!.push(source);
    }

    const nodeById = new Map<string, FolderTreeNode>();
    for (const folder of folders) {
      nodeById.set(folder.id, {
        id: folder.id,
        name: folder.name,
        parentId: folder.parentId,
        sortOrder: folder.sortOrder,
        sources: (sourcesByFolder.get(folder.id) ?? []).map((s) => mapSource(s, unreadBySource)),
        children: [],
        unreadCount: 0,
      });
    }

    const roots: FolderTreeNode[] = [];
    for (const folder of folders) {
      const node = nodeById.get(folder.id)!;
      const parentNode = folder.parentId ? nodeById.get(folder.parentId) : undefined;
      if (parentNode) parentNode.children.push(node);
      else roots.push(node);
    }

    // Rolls up so a folder's badge counts its own sources plus every
    // descendant subfolder's, since it now acts as a category, not just a leaf.
    function computeUnread(node: FolderTreeNode): number {
      const ownUnread = node.sources.reduce((sum, s) => sum + s.unreadCount, 0);
      const childrenUnread = node.children.reduce((sum, c) => sum + computeUnread(c), 0);
      node.unreadCount = ownUnread + childrenUnread;
      return node.unreadCount;
    }
    roots.forEach(computeUnread);

    return { folders: roots };
  });

  app.post<{ Body: { name: string; sortOrder?: number; parentId?: string | null } }>('/api/folders', async (req, reply) => {
    const { name, sortOrder, parentId } = req.body;
    const folder = await prisma.folder.create({ data: { name, sortOrder: sortOrder ?? 0, parentId: parentId ?? null } });
    return reply.code(201).send(folder);
  });

  app.patch<{ Params: { id: string }; Body: { name?: string; sortOrder?: number; parentId?: string | null } }>(
    '/api/folders/:id',
    async (req, reply) => {
      if (req.body.parentId) {
        if (req.body.parentId === req.params.id) {
          return reply.code(400).send({ error: 'Uma pasta não pode ser pai dela mesma.' });
        }
        if (await wouldCreateCycle(req.params.id, req.body.parentId)) {
          return reply.code(400).send({ error: 'Isso criaria um ciclo de pastas.' });
        }
      }
      return prisma.folder.update({ where: { id: req.params.id }, data: req.body });
    },
  );

  app.delete<{ Params: { id: string } }>('/api/folders/:id', async (req, reply) => {
    await prisma.folder.delete({ where: { id: req.params.id } });
    return reply.code(204).send();
  });
}
