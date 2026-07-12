/** Extracts the video ID from a youtube.com/watch, youtube.com/shorts, or youtu.be link. */
export function extractYouTubeVideoId(link: string | null | undefined): string | null {
  if (!link) return null;
  try {
    const url = new URL(link);
    if (/(^|\.)youtu\.be$/i.test(url.hostname)) {
      return url.pathname.split('/').filter(Boolean)[0] ?? null;
    }
    if (/(^|\.)youtube\.com$/i.test(url.hostname)) {
      const watchId = url.searchParams.get('v');
      if (watchId) return watchId;
      const segments = url.pathname.split('/').filter(Boolean);
      if (segments[0] === 'shorts' && segments[1]) return segments[1];
      if (segments[0] === 'embed' && segments[1]) return segments[1];
    }
  } catch {
    return null;
  }
  return null;
}

export function buildYouTubeEmbedUrl(videoId: string): string {
  return `https://www.youtube.com/embed/${videoId}`;
}
