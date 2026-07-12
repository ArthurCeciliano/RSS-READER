import { XMLParser } from 'fast-xml-parser';

export interface OpmlSourceEntry {
  title: string;
  text: string;
  xmlUrl: string;
  htmlUrl?: string;
  type?: string;
}

export interface OpmlFolder {
  name: string;
  sources: OpmlSourceEntry[];
}

export interface OpmlTree {
  title: string;
  folders: OpmlFolder[];
  /** Top-level outlines that carry an xmlUrl directly (no folder wrapper). */
  rootSources: OpmlSourceEntry[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  textNodeName: '#text',
  processEntities: true,
  htmlEntities: true,
  isArray: (name) => name === 'outline',
});

function asArray<T>(value: unknown): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value as T];
}

function toSourceEntry(node: Record<string, unknown>): OpmlSourceEntry {
  return {
    title: String(node.title ?? node.text ?? ''),
    text: String(node.text ?? node.title ?? ''),
    xmlUrl: String(node.xmlUrl ?? ''),
    htmlUrl: node.htmlUrl ? String(node.htmlUrl) : undefined,
    type: node.type ? String(node.type) : undefined,
  };
}

/**
 * Parses a Feedbro-style OPML document into folders (one level deep, per
 * Feedbro's own export format) and their contained feed sources.
 *
 * Handles the quirks seen in real Feedbro exports: HTML-escaped entities in
 * attributes (&#62; &#38;), empty folders with no children, and top-level
 * outlines that are themselves sources (no folder wrapper).
 */
export function parseOpml(xml: string): OpmlTree {
  const doc = parser.parse(xml);
  const opml = doc.opml ?? doc;
  const head = opml.head ?? {};
  const body = opml.body ?? {};
  const topOutlines = asArray<Record<string, unknown>>(body.outline);

  const folders: OpmlFolder[] = [];
  const rootSources: OpmlSourceEntry[] = [];

  for (const outline of topOutlines) {
    const hasXmlUrl = typeof outline.xmlUrl === 'string' && outline.xmlUrl.length > 0;
    if (hasXmlUrl) {
      rootSources.push(toSourceEntry(outline));
      continue;
    }

    const name = String(outline.title ?? outline.text ?? 'Untitled');
    const children = asArray<Record<string, unknown>>(outline.outline);
    const sources = children
      .filter((child) => typeof child.xmlUrl === 'string' && child.xmlUrl.length > 0)
      .map(toSourceEntry);

    folders.push({ name, sources });
  }

  return {
    title: String(head.title ?? 'Feed Subscriptions'),
    folders,
    rootSources,
  };
}
