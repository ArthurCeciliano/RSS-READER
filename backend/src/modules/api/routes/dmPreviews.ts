import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../db/prisma.js';

export async function dmPreviewsRoutes(app: FastifyInstance) {
  app.get('/api/dm-previews/pending', async () => {
    const previews = await prisma.directMessagePreview.findMany({
      where: { acknowledged: false },
      orderBy: { updatedAt: 'desc' },
    });
    return { previews };
  });

  app.post<{ Params: { id: string } }>('/api/dm-previews/:id/ack', async (req) => {
    await prisma.directMessagePreview.update({ where: { id: req.params.id }, data: { acknowledged: true } });
    return { ok: true };
  });
}
