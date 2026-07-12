export interface AdaptiveIntervalOptions {
  minMinutes: number;
  maxMinutes: number;
  defaultMinutes: number;
}

/**
 * Adjusts a source's scan interval from the average gap between its most
 * recent published items: fast-publishing sources get polled sooner,
 * dormant ones get stretched out, both clamped to the type's allowed range
 * (module 2: native RSS can go as low as 5 min, bridge-backed sources are
 * floored at 30-60 min to avoid tripping anti-scraping rate limits).
 */
export function computeAdaptiveIntervalMinutes(publishedAtDesc: Date[], options: AdaptiveIntervalOptions): number {
  if (publishedAtDesc.length < 2) return options.defaultMinutes;

  const gaps: number[] = [];
  for (let i = 0; i < publishedAtDesc.length - 1; i++) {
    const diffMs = publishedAtDesc[i].getTime() - publishedAtDesc[i + 1].getTime();
    if (diffMs > 0) gaps.push(diffMs);
  }
  if (gaps.length === 0) return options.defaultMinutes;

  const avgMs = gaps.reduce((sum, g) => sum + g, 0) / gaps.length;
  const avgMinutes = avgMs / 60_000;
  // Poll at roughly half the average publish gap so a new item is caught
  // within about one publish cycle, without hammering slow feeds.
  const target = avgMinutes / 2;
  return Math.min(options.maxMinutes, Math.max(options.minMinutes, Math.round(target)));
}

const BACKOFF_BASE_MINUTES = 5;
const BACKOFF_MAX_MINUTES = 24 * 60;

/** Exponential backoff after consecutive failures, capped at 24h. */
export function computeBackoffMinutes(consecutiveFails: number): number {
  if (consecutiveFails <= 0) return 0;
  const minutes = BACKOFF_BASE_MINUTES * 2 ** (consecutiveFails - 1);
  return Math.min(BACKOFF_MAX_MINUTES, minutes);
}

export function computeNextFetchAt(
  now: Date,
  scanIntervalMinutes: number,
  consecutiveFails: number,
): Date {
  const backoff = computeBackoffMinutes(consecutiveFails);
  const minutes = Math.max(scanIntervalMinutes, backoff);
  return new Date(now.getTime() + minutes * 60_000);
}

/** Deterministic-shape jitter (0..ratio of base) — caller supplies the random draw so this stays pure/testable. */
export function applyJitter(baseMs: number, ratio: number, random: number): number {
  const jitter = baseMs * ratio * random;
  return Math.round(baseMs + jitter);
}
