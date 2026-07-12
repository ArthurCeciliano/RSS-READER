export interface ExportSource {
  title: string;
  identityUrl: string;
  feedUrl: string | null;
  siteUrl?: string | null;
  type: string;
}

export interface ExportFolder {
  name: string;
  sources: ExportSource[];
}

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, '&#38;')
    .replace(/</g, '&#60;')
    .replace(/>/g, '&#62;')
    .replace(/"/g, '&#34;');
}

/** Bridge-backed sources round-trip using their profile URL, never the bridge URL — see module 1. */
function xmlUrlFor(source: ExportSource): string {
  if (source.type === 'instagram' || source.type === 'tiktok') return source.identityUrl;
  return source.feedUrl ?? source.identityUrl;
}

function htmlUrlFor(source: ExportSource): string | null {
  if (source.siteUrl) return source.siteUrl;
  if (source.type === 'instagram' || source.type === 'tiktok') {
    return source.identityUrl.endsWith('/') ? source.identityUrl.slice(0, -1) : source.identityUrl;
  }
  return null;
}

function renderSourceOutline(source: ExportSource): string {
  const title = escapeXmlAttr(source.title);
  const xmlUrl = escapeXmlAttr(xmlUrlFor(source));
  const htmlUrl = htmlUrlFor(source);
  const htmlAttr = htmlUrl ? ` htmlUrl="${escapeXmlAttr(htmlUrl)}"` : '';
  return `      <outline text="${title}" title="${title}" type="rss" \n            xmlUrl="${xmlUrl}"${htmlAttr}/>`;
}

/**
 * Renders folders/sources back into Feedbro-compatible OPML (one-level
 * folders, HTML-escaped attributes) so the platform stays round-trip
 * compatible with Feedbro exports, per module 4.
 */
export function exportOpml(folders: ExportFolder[]): string {
  const body = folders
    .map((folder) => {
      const name = escapeXmlAttr(folder.name);
      const outlines = folder.sources.map(renderSourceOutline).join('\n');
      return `  <outline title="${name}" text="${name}">\n${outlines}${outlines ? '\n' : ''}  </outline>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="1.0">\n<head>\n<title>Feed Subscriptions</title>\n</head>\n<body>\n${body}\n</body>\n</opml>\n`;
}
