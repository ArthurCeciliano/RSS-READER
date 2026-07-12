import { describe, expect, it } from 'vitest';
import {
  applyJitter,
  computeAdaptiveIntervalMinutes,
  computeBackoffMinutes,
  computeNextFetchAt,
} from '../src/modules/queue/scheduler.js';

describe('computeAdaptiveIntervalMinutes', () => {
  const options = { minMinutes: 5, maxMinutes: 180, defaultMinutes: 30 };

  it('returns the default when fewer than two published items exist', () => {
    expect(computeAdaptiveIntervalMinutes([], options)).toBe(30);
    expect(computeAdaptiveIntervalMinutes([new Date()], options)).toBe(30);
  });

  it('shortens the interval for a fast-publishing feed', () => {
    const now = new Date('2024-01-01T12:00:00Z');
    const items = [now, new Date(now.getTime() - 10 * 60_000), new Date(now.getTime() - 20 * 60_000)];
    const result = computeAdaptiveIntervalMinutes(items, options);
    expect(result).toBe(options.minMinutes); // avg gap 10min / 2 = 5min, floored at min
  });

  it('lengthens the interval for a dormant feed, clamped to maxMinutes', () => {
    const now = new Date('2024-01-01T12:00:00Z');
    const items = [now, new Date(now.getTime() - 20 * 24 * 60 * 60_000)];
    const result = computeAdaptiveIntervalMinutes(items, options);
    expect(result).toBe(options.maxMinutes);
  });

  it('respects a bridge-backed source floor of 30 minutes', () => {
    const bridgeOptions = { minMinutes: 30, maxMinutes: 120, defaultMinutes: 60 };
    const now = new Date('2024-01-01T12:00:00Z');
    const items = [now, new Date(now.getTime() - 5 * 60_000)];
    expect(computeAdaptiveIntervalMinutes(items, bridgeOptions)).toBe(30);
  });
});

describe('computeBackoffMinutes', () => {
  it('is zero with no failures', () => {
    expect(computeBackoffMinutes(0)).toBe(0);
  });
  it('doubles per consecutive failure', () => {
    expect(computeBackoffMinutes(1)).toBe(5);
    expect(computeBackoffMinutes(2)).toBe(10);
    expect(computeBackoffMinutes(3)).toBe(20);
  });
  it('caps at 24 hours', () => {
    expect(computeBackoffMinutes(20)).toBe(24 * 60);
  });
});

describe('computeNextFetchAt', () => {
  it('uses the larger of scan interval and backoff', () => {
    const now = new Date('2024-01-01T00:00:00Z');
    const next = computeNextFetchAt(now, 30, 0);
    expect(next.toISOString()).toBe('2024-01-01T00:30:00.000Z');

    const nextWithBackoff = computeNextFetchAt(now, 30, 3); // backoff = 20min < 30min scan interval
    expect(nextWithBackoff.toISOString()).toBe('2024-01-01T00:30:00.000Z');

    const nextWithBiggerBackoff = computeNextFetchAt(now, 30, 5); // backoff = 80min > scan interval
    expect(nextWithBiggerBackoff.toISOString()).toBe('2024-01-01T01:20:00.000Z');
  });
});

describe('applyJitter', () => {
  it('adds up to ratio*base extra delay based on the injected random draw', () => {
    expect(applyJitter(1000, 0.2, 0)).toBe(1000);
    expect(applyJitter(1000, 0.2, 1)).toBe(1200);
    expect(applyJitter(1000, 0.2, 0.5)).toBe(1100);
  });
});
