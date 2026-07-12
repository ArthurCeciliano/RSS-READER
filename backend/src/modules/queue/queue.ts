import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from '../../config/env.js';

export function createRedisConnection(): Redis {
  return new Redis(env.redisUrl, { maxRetriesPerRequest: null });
}

export const FEED_REFRESH_QUEUE = 'feed-refresh';

export interface FeedRefreshJobData {
  sourceId: string;
  manual?: boolean;
}

let queueSingleton: Queue<FeedRefreshJobData> | null = null;

export function getFeedRefreshQueue(connection: Redis = createRedisConnection()): Queue<FeedRefreshJobData> {
  if (!queueSingleton) {
    queueSingleton = new Queue<FeedRefreshJobData>(FEED_REFRESH_QUEUE, { connection });
  }
  return queueSingleton;
}
