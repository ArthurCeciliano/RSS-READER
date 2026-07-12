import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../../db/prisma.js';

const DEFAULT_SETTINGS: Record<string, unknown> = {
  theme: 'dark',
  feedLoadTimeoutSeconds: 25,
  defaultScanIntervalMinutes: 30,
  feedUpdateThreads: 4,
  defaultMaxEntries: 20,
  inactiveFeedLimitDays: 180,
  dateFormat: 'EEE MMM d yyyy HH:mm:ss',
  articleTitleFontSize: 100,
  articleBodyFontSize: 110,
  articleBodyLineHeight: 1.45,
  articleFontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Helvetica Neue"',
  markArticleAsRead: 'on_display',
  confirmMarkAllRead: 'all_items_only',
  faviconProvider: 'google',
  useFaviconsInNavigator: true,
  useFaviconsIn3PanelTitles: true,
  showLatestArticlesPopup: true,
  mathJaxEnabled: false,
  justifyText: false,
  truncateLongTitles: true,
  skipExistingOpmlEntries: true,
  disableAutomaticFeedScanning: false,
  removedTags: { script: true, object: true, applet: true, iframe: false, embed: false },
};

export async function settingsRoutes(app: FastifyInstance) {
  app.get('/api/settings', async () => {
    const rows = await prisma.setting.findMany();
    const overrides = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return { ...DEFAULT_SETTINGS, ...overrides };
  });

  app.put<{ Body: Record<string, unknown> }>('/api/settings', async (req) => {
    const entries = Object.entries(req.body);
    await Promise.all(
      entries.map(([key, value]) =>
        prisma.setting.upsert({
          where: { key },
          update: { value: value as Prisma.InputJsonValue },
          create: { key, value: value as Prisma.InputJsonValue },
        }),
      ),
    );
    return { updated: entries.length };
  });
}
