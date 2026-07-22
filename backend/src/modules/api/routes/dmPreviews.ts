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

  // Bulk-dismiss without opening Instagram for each one — mainly for the
  // first-ever sync's backlog (every conversation the user already knew
  // about shows up as "new" that one time, since there's no prior baseline).
  app.post('/api/dm-previews/ack-all', async () => {
    const result = await prisma.directMessagePreview.updateMany({ where: { acknowledged: false }, data: { acknowledged: true } });
    return { updated: result.count };
  });
}
