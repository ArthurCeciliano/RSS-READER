import { describe, expect, it } from 'vitest';
import { canClaimFolderRun, FOLDER_RUN_LOCK_STALE_MS } from '../src/modules/instagram/folderRunLock.js';

describe('canClaimFolderRun', () => {
  it('grants the claim when the folder has never been claimed', () => {
    expect(canClaimFolderRun({}, 'china', Date.now())).toBe(true);
  });

  it('denies a second claim while the first is still fresh', () => {
    const now = 1_000_000;
    const locks = { china: now };
    expect(canClaimFolderRun(locks, 'china', now + 60_000)).toBe(false); // 1 min later — a device is presumably still mid-run
  });

  it('denies right up to the staleness threshold', () => {
    const now = 1_000_000;
    const locks = { china: now };
    expect(canClaimFolderRun(locks, 'china', now + FOLDER_RUN_LOCK_STALE_MS - 1)).toBe(false);
  });

  it('grants again once the previous claim is stale (e.g. a crashed run)', () => {
    const now = 1_000_000;
    const locks = { china: now };
    expect(canClaimFolderRun(locks, 'china', now + FOLDER_RUN_LOCK_STALE_MS)).toBe(true);
  });

  it('does not let one folder\'s claim block another folder', () => {
    const now = 1_000_000;
    const locks = { china: now };
    expect(canClaimFolderRun(locks, 'other-folder', now + 1)).toBe(true);
  });
});
