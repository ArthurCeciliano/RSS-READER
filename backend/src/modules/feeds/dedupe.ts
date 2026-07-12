import { createHash } from 'node:crypto';

export interface DedupeInput {
  guid?: string;
  link?: string;
  title: string;
  publishedAt?: Date;
}

/**
 * Stable per-item hash: guid takes priority, then link, then title+date.
 * Re-fetching the same feed must yield identical hashes for unchanged items
 * so the (sourceId, dedupeHash) unique constraint prevents duplicates.
 */
export function computeDedupeHash(input: DedupeInput): string {
  const basis = input.guid
    ? `guid:${input.guid}`
    : input.link
      ? `link:${input.link}`
      : `td:${input.title}|${input.publishedAt ? input.publishedAt.toISOString() : ''}`;
  return createHash('sha256').update(basis).digest('hex');
}
