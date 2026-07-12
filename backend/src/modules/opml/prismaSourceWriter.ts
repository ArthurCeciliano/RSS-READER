import type { PrismaClient } from '@prisma/client';
import type { PlannedSource, SourceWriter } from './opmlImporter.js';
import { env } from '../../config/env.js';

export function createPrismaSourceWriter(prisma: PrismaClient): SourceWriter {
  const folderIdCache = new Map<string, string>();

  return {
    async exists(identityUrl: string) {
      const found = await prisma.source.findUnique({ where: { identityUrl }, select: { id: true } });
      return found !== null;
    },

    async upsertFolder(name: string, sortOrder: number) {
      const cached = folderIdCache.get(name);
      if (cached) return cached;
      const existing = await prisma.folder.findFirst({ where: { name, parentId: null }, select: { id: true } });
      const folderId = existing?.id ?? (await prisma.folder.create({ data: { name, sortOrder }, select: { id: true } })).id;
      folderIdCache.set(name, folderId);
      return folderId;
    },

    async createSource(folderId: string | null, sortOrder: number, planned: PlannedSource) {
      const isBridge = planned.type === 'instagram' || planned.type === 'tiktok';
      await prisma.source.create({
        data: {
          folderId,
          sortOrder,
          title: planned.title,
          identityUrl: planned.identityUrl,
          feedUrl: planned.feedUrl,
          siteUrl: planned.originalHtmlUrl,
          type: planned.type,
          scanIntervalMinutes: isBridge ? env.minScanIntervalMinutesBridge : env.defaultScanIntervalMinutes,
          maxEntries: env.defaultMaxEntries,
          inactiveLimitDays: env.defaultInactiveLimitDays,
        },
      });
    },
  };
}
