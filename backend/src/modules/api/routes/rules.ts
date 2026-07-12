import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../../db/prisma.js';

interface RuleBody {
  name: string;
  enabled?: boolean;
  conditions: unknown;
  actions: unknown;
  sortOrder?: number;
}

export async function rulesRoutes(app: FastifyInstance) {
  app.get('/api/rules', async () => {
    const rules = await prisma.rule.findMany({ orderBy: { sortOrder: 'asc' } });
    return { rules };
  });

  app.post<{ Body: RuleBody }>('/api/rules', async (req, reply) => {
    const { name, enabled = true, conditions, actions, sortOrder = 0 } = req.body;
    const rule = await prisma.rule.create({
      data: {
        name,
        enabled,
        conditions: conditions as Prisma.InputJsonValue,
        actions: actions as Prisma.InputJsonValue,
        sortOrder,
      },
    });
    return reply.code(201).send(rule);
  });

  app.patch<{ Params: { id: string }; Body: Partial<RuleBody> }>('/api/rules/:id', async (req) => {
    const { name, enabled, conditions, actions, sortOrder } = req.body;
    return prisma.rule.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(enabled !== undefined ? { enabled } : {}),
        ...(conditions !== undefined ? { conditions: conditions as Prisma.InputJsonValue } : {}),
        ...(actions !== undefined ? { actions: actions as Prisma.InputJsonValue } : {}),
        ...(sortOrder !== undefined ? { sortOrder } : {}),
      },
    });
  });

  app.delete<{ Params: { id: string } }>('/api/rules/:id', async (req, reply) => {
    await prisma.rule.delete({ where: { id: req.params.id } });
    return reply.code(204).send();
  });
}
