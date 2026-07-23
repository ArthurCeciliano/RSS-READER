import type { PrismaClient, Prisma } from '@prisma/client';

/**
 * Cross-device guard for Instagram folder syncs. The per-folder schedule
 * ("Configurações → Agendamento por pasta") is shared server-side, but the
 * extension can be installed on more than one browser/machine, each ticking
 * its own alarm every few minutes and deciding independently "this folder's
 * slot has passed, let's run it" — with nothing to stop two devices (or a
 * service-worker restart racing the next tick on the same device) from
 * opening the same profiles minutes apart. This is the shared source of
 * truth that lets a second claimant back off instead of piling more
 * Instagram traffic onto a folder that's already being (or was just)
 * synced.
 */
export const FOLDER_RUN_LOCK_SETTING_KEY = 'instagramFolderRunLocks';

// Comfortably longer than any real folder run (worst case: ~20 profiles at a
// 45s gap plus tab-load/scrape time is still well under half this), so a
// stale claim only unblocks once a run has plausibly crashed or been killed
// (e.g. the extension's service worker got terminated mid-run) rather than
// while it's still legitimately in progress.
export const FOLDER_RUN_LOCK_STALE_MS = 90 * 60 * 1000;

type LockMap = Record<string, number>;

function parseLockMap(value: unknown): LockMap {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as LockMap;
  return {};
}

/** Pure decision, kept separate from the Prisma I/O so it's cheaply unit-testable. */
export function canClaimFolderRun(
  locks: LockMap,
  folderId: string,
  now: number,
  staleAfterMs: number = FOLDER_RUN_LOCK_STALE_MS,
): boolean {
  const claimedAt = locks[folderId];
  return claimedAt == null || now - claimedAt >= staleAfterMs;
}

/**
 * Attempts to claim folderId for the caller. Returns true if granted (no
 * unexpired claim existed), false if another claimant already holds it.
 * Not perfectly atomic under a true simultaneous race (read-then-write on a
 * single Setting row), but claims here are minutes apart at worst — a
 * negligible residual risk against the alternative of a full new table/lock
 * migration for what is already a big improvement over no cross-device
 * coordination at all.
 */
export async function claimFolderRun(prisma: PrismaClient, folderId: string, now = Date.now()): Promise<boolean> {
  const row = await prisma.setting.findUnique({ where: { key: FOLDER_RUN_LOCK_SETTING_KEY } });
  const locks = parseLockMap(row?.value);
  if (!canClaimFolderRun(locks, folderId, now)) return false;

  locks[folderId] = now;
  await prisma.setting.upsert({
    where: { key: FOLDER_RUN_LOCK_SETTING_KEY },
    update: { value: locks as unknown as Prisma.InputJsonValue },
    create: { key: FOLDER_RUN_LOCK_SETTING_KEY, value: locks as unknown as Prisma.InputJsonValue },
  });
  return true;
}
