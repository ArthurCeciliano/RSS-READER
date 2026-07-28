/**
 * Instagram-style relative time in pt-BR: "agora", "há 30 min", "há 4 h",
 * "há 3 dias", switching to an absolute date "02/07/2026" once older than a
 * week — the same progression Instagram itself shows. Fed with the real post
 * date (publishedAt) when we have it, falling back to when we first saw the item.
 */
export function relativeTime(input: string | Date | null | undefined): string {
  if (!input) return '';
  const date = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(date.getTime())) return '';

  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 45) return 'agora';

  const minutes = Math.max(1, Math.floor(seconds / 60));
  if (minutes < 60) return `há ${minutes} min`;

  const hours = Math.floor(seconds / 3600);
  if (hours < 24) return `há ${hours} h`;

  const days = Math.floor(seconds / 86400);
  if (days < 7) return `há ${days} ${days === 1 ? 'dia' : 'dias'}`;

  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${date.getFullYear()}`;
}
