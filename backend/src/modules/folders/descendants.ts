import type { PrismaClient } from '@prisma/client';

/**
 * A folder can now contain subfolders (Folder.parentId), so "give me
 * everything under this folder" (item list, mark-all-read, refresh-all) needs
 * this folder's id plus every descendant folder's id, not just its own —
 * otherwise selecting a parent folder that only ever holds subfolders (no
 * sources directly on it) would show/affect nothing at all.
 */
export async function collectFolderAndDescendantIds(prisma: PrismaClient, rootId: string): Promise<string[]> {
  const allFolders = await prisma.folder.findMany({ select: { id: true, parentId: true } });
  const childrenByParent = new Map<string, string[]>();
  for (const f of allFolders) {
    if (!f.parentId) continue;
    if (!childrenByParent.has(f.parentId)) childrenByParent.set(f.parentId, []);
    childrenByParent.get(f.parentId)!.push(f.id);
  }

  const result: string[] = [rootId];
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const childId of childrenByParent.get(current) ?? []) {
      result.push(childId);
      queue.push(childId);
    }
  }
  return result;
}
