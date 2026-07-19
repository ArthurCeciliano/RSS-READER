import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../db/prisma.js';
import { verifyExtensionToken } from '../extensionAuth.js';
import { extractInstagramUsername } from '../../sources/instagramUsername.js';
import { finalizeSuccessfulIngest } from '../../feeds/ingest.js';
import type { ParsedFeedItem } from '../../feeds/feedParser.js';

interface ExtensionPushItem {
  guid: string;
  link: string;
  title: string;
  summary?: string;
  imageUrl?: string;
  author?: string;
  publishedAt?: string;
}

interface DmConversationPreview {
  senderName: string;
  previewText: string;
  avatarUrl?: string;
}

/**
 * Consumed only by the "RSS Reader - Instagram Bridge" browser extension
 * (extension/), which fetches Instagram content from the user's own logged-in
 * browser session (residential IP, real cookie) and pushes it here — the VPS
 * itself is a datacenter IP that Instagram blocks regardless of auth, so it
 * can't fetch this content directly (see docker-compose.prod.yml / IG_COOKIE).
 * This is the app's first authenticated surface: a preHandler scoped to this
 * plugin only checks a shared token, generated/rotated from Settings.
 */
export async function extensionRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req, reply) => {
    const header = req.headers['x-extension-token'];
    const presented = Array.isArray(header) ? header[0] : header;
    if (!(await verifyExtensionToken(prisma, presented))) {
      return reply.code(401).send({ error: 'invalid or missing extension token' });
    }
  });

  app.get('/api/extension/instagram/due', async () => {
    const now = new Date();
    const due = await prisma.source.findMany({
      where: { type: 'instagram', OR: [{ nextFetchAt: null }, { nextFetchAt: { lte: now } }] },
      select: { id: true, identityUrl: true },
    });
    return {
      sources: due.map((s) => ({ sourceId: s.id, username: extractInstagramUsername(s.identityUrl) })),
    };
  });

  app.post<{ Params: { sourceId: string }; Body: { items?: ExtensionPushItem[]; hasActiveStory?: boolean } }>(
    '/api/extension/instagram/:sourceId/items',
    async (req, reply) => {
      const source = await prisma.source.findUnique({ where: { id: req.params.sourceId } });
      if (!source || source.type !== 'instagram') {
        return reply.code(404).send({ error: 'instagram source not found' });
      }
      if (!Array.isArray(req.body?.items)) {
        return reply.code(400).send({ error: 'items must be an array' });
      }

      const items: ParsedFeedItem[] = req.body.items.map((i) => ({
        guid: i.guid,
        link: i.link,
        title: i.title || '(untitled)',
        summary: i.summary,
        imageUrl: i.imageUrl,
        author: i.author,
        publishedAt: i.publishedAt ? new Date(i.publishedAt) : undefined,
      }));

      const { newItemCount } = await finalizeSuccessfulIngest(prisma, source, items);

      // Independent of item ingestion: always overwritten with whatever this
      // visit observed, so it self-corrects once a story expires (24h) without
      // needing any separate expiry job.
      if (typeof req.body.hasActiveStory === 'boolean' && req.body.hasActiveStory !== source.hasActiveStory) {
        await prisma.source.update({ where: { id: source.id }, data: { hasActiveStory: req.body.hasActiveStory } });
      }

      return { newItemCount };
    },
  );

  // No per-conversation link exists to deep-link into (Instagram's inbox list
  // is client-side-routed with no real <a href>, and discovering one would
  // mean opening the thread ourselves — which likely marks it "seen" for the
  // sender). So this just mirrors the same preview snippet already visible in
  // the inbox list; the app links out to the generic inbox, never a thread.
  app.post<{ Body: { conversations?: DmConversationPreview[] } }>(
    '/api/extension/instagram/dm-inbox',
    async (req, reply) => {
      if (!Array.isArray(req.body?.conversations)) {
        return reply.code(400).send({ error: 'conversations must be an array' });
      }
      for (const c of req.body.conversations) {
        if (!c.senderName || !c.previewText) continue;
        const existing = await prisma.directMessagePreview.findUnique({ where: { senderName: c.senderName } });
        if (!existing) {
          await prisma.directMessagePreview.create({
            data: { senderName: c.senderName, previewText: c.previewText, avatarUrl: c.avatarUrl },
          });
        } else if (existing.previewText !== c.previewText) {
          // New message content since we last saw this conversation -- worth notifying again.
          await prisma.directMessagePreview.update({
            where: { id: existing.id },
            data: { previewText: c.previewText, avatarUrl: c.avatarUrl ?? existing.avatarUrl, acknowledged: false },
          });
        } else if (c.avatarUrl && c.avatarUrl !== existing.avatarUrl) {
          await prisma.directMessagePreview.update({ where: { id: existing.id }, data: { avatarUrl: c.avatarUrl } });
        }
      }
      return reply.send({ ok: true });
    },
  );
}
