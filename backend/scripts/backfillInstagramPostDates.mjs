// One-shot backfill: fill in publishedAt for Instagram items that were ingested
// before the extension started sending real post dates. The post's creation time
// is encoded in its shortcode (guid), so we can recover it with zero Instagram
// requests — decode the base64 shortcode to the media id, then (id >> 23) ms plus
// the Instagram epoch is the publish time (validated against real posts).
//
// Safe to run more than once: it only touches instagram items whose publishedAt
// is still null, and skips anything that doesn't decode to a plausible date.
//
// Run it inside the running `app` container (which has @prisma/client + the DB
// url), e.g. from the repo root on the VPS:
//   docker compose -f docker-compose.prod.yml cp \
//     backend/scripts/backfillInstagramPostDates.mjs app:/app/backfill.mjs
//   docker compose -f docker-compose.prod.yml exec app node /app/backfill.mjs

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const EPOCH_MS = 1314220021721n;

function shortcodeFrom(item) {
  if (item.guid && /^[A-Za-z0-9_-]+$/.test(item.guid)) return item.guid;
  const m = (item.link || '').match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

function shortcodeToDate(shortcode) {
  if (!shortcode) return null;
  let id = 0n;
  for (const ch of shortcode) {
    const k = ALPHABET.indexOf(ch);
    if (k < 0) return null;
    id = id * 64n + BigInt(k);
  }
  const ms = Number((id >> 23n) + EPOCH_MS);
  // Plausible window: 2012-01-01 .. now + 1 day. Fails closed otherwise.
  if (!Number.isFinite(ms) || ms < 1325376000000 || ms > Date.now() + 86400000) return null;
  return new Date(ms);
}

async function main() {
  const items = await prisma.item.findMany({
    where: { publishedAt: null, source: { type: 'instagram' } },
    select: { id: true, guid: true, link: true },
  });
  console.log(`Instagram items sem data: ${items.length}`);

  let updated = 0;
  let skipped = 0;
  for (const item of items) {
    const date = shortcodeToDate(shortcodeFrom(item));
    if (!date) {
      skipped += 1;
      continue;
    }
    await prisma.item.update({ where: { id: item.id }, data: { publishedAt: date } });
    updated += 1;
    if (updated % 200 === 0) console.log(`  ...${updated} atualizados`);
  }

  console.log(`Concluído: ${updated} atualizados, ${skipped} pulados (shortcode indecifrável).`);
}

main()
  .catch((err) => {
    console.error('Falha no backfill:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
