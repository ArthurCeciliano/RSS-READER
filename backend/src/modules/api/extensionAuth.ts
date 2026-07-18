import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

export const EXTENSION_TOKEN_SETTING_KEY = 'extensionApiToken';

function generateToken(): string {
  return randomBytes(32).toString('hex');
}

async function readToken(prisma: PrismaClient): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key: EXTENSION_TOKEN_SETTING_KEY } });
  return typeof row?.value === 'string' ? row.value : null;
}

async function writeToken(prisma: PrismaClient, token: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key: EXTENSION_TOKEN_SETTING_KEY },
    update: { value: token },
    create: { key: EXTENSION_TOKEN_SETTING_KEY, value: token },
  });
}

/** Returns the current extension API token, generating and persisting one on first use. */
export async function getOrCreateExtensionToken(prisma: PrismaClient): Promise<string> {
  const existing = await readToken(prisma);
  if (existing) return existing;
  const token = generateToken();
  await writeToken(prisma, token);
  return token;
}

/** Always generates and persists a brand-new token, invalidating whatever the extension currently holds. */
export async function regenerateExtensionToken(prisma: PrismaClient): Promise<string> {
  const token = generateToken();
  await writeToken(prisma, token);
  return token;
}

/** Timing-safe comparison of a presented header value against the stored token. */
export async function verifyExtensionToken(prisma: PrismaClient, presented: string | undefined): Promise<boolean> {
  if (!presented) return false;
  const stored = await readToken(prisma);
  if (!stored) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(stored);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
