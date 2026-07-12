import type { PrismaClient } from '@prisma/client';
import type { RuleActionSpec } from './ruleEngine.js';

/** Applies the flattened action list from collectActionsForContext to one item. */
export async function applyActionsToItem(prisma: PrismaClient, itemId: string, actions: RuleActionSpec[]): Promise<void> {
  if (actions.length === 0) return;

  const data: { isRead?: boolean; isStarred?: boolean; pendingDesktopNotify?: boolean; pendingSound?: boolean } = {};
  if (actions.some((a) => a.type === 'mark_read')) data.isRead = true;
  if (actions.some((a) => a.type === 'star')) data.isStarred = true;
  if (actions.some((a) => a.type === 'notify_desktop')) data.pendingDesktopNotify = true;
  if (actions.some((a) => a.type === 'play_sound')) data.pendingSound = true;

  if (Object.keys(data).length > 0) {
    await prisma.item.update({ where: { id: itemId }, data });
  }

  const tagNames = [...new Set(actions.filter((a) => a.type === 'apply_tag' && a.tagName).map((a) => a.tagName as string))];
  for (const tagName of tagNames) {
    const tag = await prisma.tag.upsert({ where: { name: tagName }, update: {}, create: { name: tagName } });
    await prisma.tagsOnItems.upsert({
      where: { itemId_tagId: { itemId, tagId: tag.id } },
      update: {},
      create: { itemId, tagId: tag.id },
    });
  }
}
