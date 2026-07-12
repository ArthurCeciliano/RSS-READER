import 'dotenv/config';

function optionalInt(value: string | undefined, fallback: number): number {
  const parsed = value ? Number.parseInt(value, 10) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const env = {
  port: optionalInt(process.env.PORT, 3001),
  databaseUrl: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/rss_reader',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  feedUpdateThreads: optionalInt(process.env.FEED_UPDATE_THREADS, 4),
  defaultScanIntervalMinutes: optionalInt(process.env.DEFAULT_SCAN_INTERVAL_MINUTES, 30),
  minScanIntervalMinutesNative: optionalInt(process.env.MIN_SCAN_INTERVAL_NATIVE, 5),
  minScanIntervalMinutesBridge: optionalInt(process.env.MIN_SCAN_INTERVAL_BRIDGE, 30),
  maxScanIntervalMinutes: optionalInt(process.env.MAX_SCAN_INTERVAL_MINUTES, 180),
  defaultMaxEntries: optionalInt(process.env.DEFAULT_MAX_ENTRIES, 20),
  defaultInactiveLimitDays: optionalInt(process.env.DEFAULT_INACTIVE_LIMIT_DAYS, 180),
  feedLoadTimeoutMs: optionalInt(process.env.FEED_LOAD_TIMEOUT_MS, 25_000),
  domainLockTtlMs: optionalInt(process.env.DOMAIN_LOCK_TTL_MS, 15_000),
  domainJitterRatio: Number.parseFloat(process.env.DOMAIN_JITTER_RATIO ?? '0.3'),
  /** Ordered bridge instance lists per source type; first is tried first, failover to the next on repeated failure. */
  instagramBridgeInstances: (process.env.INSTAGRAM_BRIDGE_INSTANCES ?? 'http://rsshub:1200').split(',').map((s) => s.trim()),
  instagramBridgeRoute: process.env.INSTAGRAM_BRIDGE_ROUTE ?? '/picnob/user/:username',
  tiktokBridgeInstances: (process.env.TIKTOK_BRIDGE_INSTANCES ?? 'http://rsshub:1200').split(',').map((s) => s.trim()),
  tiktokBridgeRoute: process.env.TIKTOK_BRIDGE_ROUTE ?? '/tiktok/user/@:username',
  /** Combined-deploy mode (e.g. a single Render Web Service): server.ts also runs the BullMQ worker and serves the frontend build. */
  runWorkerInProcess: process.env.RUN_WORKER_IN_PROCESS !== 'false',
  serveFrontend: process.env.SERVE_FRONTEND !== 'false',
  frontendDistPath: process.env.FRONTEND_DIST_PATH ?? '../../frontend/dist',
};
