import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../db/prisma.js';

export async function tagsRoutes(app: FastifyInstance) {
  app.get('/api/tags', async () => {
    const tags = await prisma.tag.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, _count: { select: { items: true } } },
    });
    return { tags: tags.map((t) => ({ id: t.id, name: t.name, itemCount: t._count.items })) };
  });

  app.delete<{ Params: { id: string } }>('/api/tags/:id', async (req, reply) => {
    await prisma.tag.delete({ where: { id: req.params.id } });
    return reply.code(204).send();
  });
}
