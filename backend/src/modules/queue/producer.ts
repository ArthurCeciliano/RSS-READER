import type { PrismaClient } from '@prisma/client';
import type { Queue } from 'bullmq';
import type { FeedRefreshJobData } from './queue.js';

/** Enqueues every source whose nextFetchAt has passed (the recurring scheduler tick). */
export async function enqueueDueSources(prisma: PrismaClient, queue: Queue<FeedRefreshJobData>, now = new Date()): Promise<number> {
  const due = await prisma.source.findMany({
    where: { OR: [{ nextFetchAt: null }, { nextFetchAt: { lte: now } }] },
    select: { id: true },
  });
  for (const source of due) {
    await queue.add('refresh', { sourceId: source.id }, { jobId: `scheduled:${source.id}:${now.getTime()}` });
  }
  return due.length;
}

/** "Atualizar agora": jumps the queue with high priority (module 2). */
export async function enqueueManualRefresh(queue: Queue<FeedRefreshJobData>, sourceIds: string[]): Promise<void> {
  for (const sourceId of sourceIds) {
    await queue.add(
      'refresh',
      { sourceId, manual: true },
      { priority: 1, jobId: `manual:${sourceId}:${Date.now()}` },
    );
  }
}
