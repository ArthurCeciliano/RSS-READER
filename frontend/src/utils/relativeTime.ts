const UNITS: Array<[string, number]> = [
  ['year', 365 * 24 * 60 * 60],
  ['month', 30 * 24 * 60 * 60],
  ['week', 7 * 24 * 60 * 60],
  ['day', 24 * 60 * 60],
  ['hour', 60 * 60],
  ['minute', 60],
];

/** Feedbro-style relative time: "20 minutes", "3 days" — no "ago" suffix. */
export function relativeTime(input: string | Date | null | undefined): string {
  if (!input) return '';
  const date = typeof input === 'string' ? new Date(input) : input;
  const diffSeconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (diffSeconds < 60) return 'just now';

  for (const [unit, secondsInUnit] of UNITS) {
    if (diffSeconds >= secondsInUnit) {
      const value = Math.floor(diffSeconds / secondsInUnit);
      return `${value} ${unit}${value === 1 ? '' : 's'}`;
    }
  }
  return 'just now';
}
