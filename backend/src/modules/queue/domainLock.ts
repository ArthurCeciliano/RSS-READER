import type { Redis } from 'ioredis';

export function extractDomain(url: string): string {
  return new URL(url).hostname;
}

export class DomainBusyError extends Error {
  constructor(domain: string) {
    super(`domain busy: ${domain}`);
    this.name = 'DomainBusyError';
  }
}

/**
 * Enforces "no more than 1 concurrent request per domain" (module 2) using a
 * Redis SET NX PX lock so it works across every worker process, not just
 * in-process. Throws DomainBusyError when the lock can't be acquired; the
 * caller is expected to re-enqueue the job with a short jittered delay.
 */
export async function withDomainLock<T>(redis: Redis, url: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const domain = extractDomain(url);
  const key = `domain-lock:${domain}`;
  const acquired = await redis.set(key, '1', 'PX', ttlMs, 'NX');
  if (!acquired) throw new DomainBusyError(domain);
  try {
    return await fn();
  } finally {
    await redis.del(key);
  }
}
