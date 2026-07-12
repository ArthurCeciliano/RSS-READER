import { Worker, type Job } from 'bullmq';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { createRedisConnection, FEED_REFRESH_QUEUE, getFeedRefreshQueue, type FeedRefreshJobData } from './queue.js';
import { enqueueDueSources } from './producer.js';
import { ingestSource } from '../feeds/ingest.js';

const connection = createRedisConnection();
const redisForLocks = createRedisConnection();
const queue = getFeedRefreshQueue(connection);

async function processTick() {
  const count = await enqueueDueSources(prisma, queue);
  if (count > 0) console.log(`[scheduler] enqueued ${count} due source(s)`);
}

async function processRefresh(sourceId: string) {
  const source = await prisma.source.findUnique({ where: { id: sourceId } });
  if (!source) return;
  const result = await ingestSource(source, { prisma, redis: redisForLocks });
  console.log(`[ingest] ${source.title} -> ${result.outcome} (${result.newItemCount} new)`);
}

const worker = new Worker<FeedRefreshJobData>(
  FEED_REFRESH_QUEUE,
  async (job: Job<FeedRefreshJobData>) => {
    if (job.name === 'tick') return processTick();
    return processRefresh(job.data.sourceId);
  },
  { connection, concurrency: env.feedUpdateThreads },
);

worker.on('failed', (job, err) => {
  console.error(`[worker] job ${job?.id} (${job?.name}) failed:`, err);
});

async function scheduleTick() {
  await queue.add('tick', {} as FeedRefreshJobData, {
    repeat: { every: 60_000 },
    jobId: 'scheduler-tick',
  });
}

scheduleTick().catch((err) => console.error('[worker] failed to schedule tick', err));

console.log(`[worker] started with concurrency=${env.feedUpdateThreads}`);
