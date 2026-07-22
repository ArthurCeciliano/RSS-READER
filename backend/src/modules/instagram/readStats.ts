import type { PrismaClient, Prisma } from '@prisma/client';

/**
 * Instagram "read" telemetry, so the app can show whether we're pacing safely
 * or drifting into rate-limit territory. A "read" is one profile the extension
 * opened (ok = posts read, empty = loaded but no posts, blocked = IG refused).
 * Stored as a single Setting JSON (no migration): daily buckets with a
 * per-folder breakdown, pruned to the last few weeks.
 */
export const READ_STATS_SETTING_KEY = 'instagramReadStats';

// Reference thresholds for daily read volume (see StatsPage risk table). These
// are estimates, not official IG numbers — blocks are the harder signal.
export const SAFE_READS_PER_DAY = 200;
export const ATTENTION_READS_PER_DAY = 350;

const MAX_DAYS = 21;
const FOLDER_WINDOW_DAYS = 7;
const DAILY_SERIES_DAYS = 14;

interface FolderBucket {
  name: string;
  reads: number;
  ok: number;
  empty: number;
  blocked: number;
}

interface DayBucket {
  reads: number;
  ok: number;
  empty: number;
  blocked: number;
  newItems: number;
  folders: Record<string, FolderBucket>;
}

interface ReadStats {
  updatedAt: string;
  days: Record<string, DayBucket>;
}

export interface ReadRunEntry {
  folderId: string;
  folderName: string;
  ok: number;
  empty: number;
  blocked: number;
  newItems: number;
}

function utcDayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function emptyDay(): DayBucket {
  return { reads: 0, ok: 0, empty: 0, blocked: 0, newItems: 0, folders: {} };
}

function parseStats(value: unknown): ReadStats {
  const s = value as ReadStats | null;
  if (s && typeof s === 'object' && s.days) return s;
  return { updatedAt: '', days: {} };
}

/** Folds one folder run into today's bucket and prunes old days. */
export async function recordReadRun(prisma: PrismaClient, entry: ReadRunEntry): Promise<void> {
  const row = await prisma.setting.findUnique({ where: { key: READ_STATS_SETTING_KEY } });
  const stats = parseStats(row?.value);
  const key = utcDayKey();
  const day = stats.days[key] ?? emptyDay();

  const reads = entry.ok + entry.empty + entry.blocked;
  day.reads += reads;
  day.ok += entry.ok;
  day.empty += entry.empty;
  day.blocked += entry.blocked;
  day.newItems += entry.newItems;

  const folder = day.folders[entry.folderId] ?? { name: entry.folderName, reads: 0, ok: 0, empty: 0, blocked: 0 };
  folder.name = entry.folderName;
  folder.reads += reads;
  folder.ok += entry.ok;
  folder.empty += entry.empty;
  folder.blocked += entry.blocked;
  day.folders[entry.folderId] = folder;

  stats.days[key] = day;

  const keys = Object.keys(stats.days).sort();
  while (keys.length > MAX_DAYS) {
    const oldest = keys.shift();
    if (oldest) delete stats.days[oldest];
  }
  stats.updatedAt = new Date().toISOString();

  await prisma.setting.upsert({
    where: { key: READ_STATS_SETTING_KEY },
    update: { value: stats as unknown as Prisma.InputJsonValue },
    create: { key: READ_STATS_SETTING_KEY, value: stats as unknown as Prisma.InputJsonValue },
  });
}

export type RiskLevel = 'safe' | 'attention' | 'risk';
export type FolderSignal = 'ok' | 'high' | 'problem';

export interface InstagramStatsResponse {
  hasData: boolean;
  updatedAt: string | null;
  today: { reads: number; ok: number; empty: number; blocked: number };
  blocks48h: number;
  risk: { level: RiskLevel; label: string; reason: string };
  daily: Array<{ date: string; reads: number; blocked: number; empty: number }>;
  folders: Array<{
    folderId: string;
    name: string;
    profiles: number;
    reads7d: number;
    empty7d: number;
    blocked7d: number;
    signal: FolderSignal;
    note: string;
  }>;
  thresholds: { safePerDay: number; attentionPerDay: number };
}

function lastNDayKeys(n: number): string[] {
  const keys: string[] = [];
  for (let i = n - 1; i >= 0; i--) keys.push(utcDayKey(new Date(Date.now() - i * 86_400_000)));
  return keys;
}

/** Builds "Parent / Child" display names so the folder view matches the schedule editor. */
function folderPathNames(folders: Array<{ id: string; name: string; parentId: string | null }>): Map<string, string> {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const paths = new Map<string, string>();
  for (const f of folders) {
    const parts: string[] = [];
    let cur: (typeof folders)[number] | undefined = f;
    const guard = new Set<string>();
    while (cur && !guard.has(cur.id)) {
      guard.add(cur.id);
      parts.unshift(cur.name);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    paths.set(f.id, parts.join(' / '));
  }
  return paths;
}

/** Aggregates the stored telemetry + current folder membership into the risk view. */
export async function computeInstagramStats(prisma: PrismaClient): Promise<InstagramStatsResponse> {
  const [row, folders, igSources] = await Promise.all([
    prisma.setting.findUnique({ where: { key: READ_STATS_SETTING_KEY } }),
    prisma.folder.findMany({ select: { id: true, name: true, parentId: true } }),
    prisma.source.findMany({ where: { type: 'instagram' }, select: { folderId: true } }),
  ]);
  const stats = parseStats(row?.value);
  const hasData = Object.keys(stats.days).length > 0;

  const paths = folderPathNames(folders);
  const profilesByFolder = new Map<string, number>();
  for (const s of igSources) {
    if (s.folderId) profilesByFolder.set(s.folderId, (profilesByFolder.get(s.folderId) ?? 0) + 1);
  }

  const todayKey = utcDayKey();
  const yesterdayKey = utcDayKey(new Date(Date.now() - 86_400_000));
  const todayBucket = stats.days[todayKey] ?? emptyDay();
  const blocks48h = (stats.days[todayKey]?.blocked ?? 0) + (stats.days[yesterdayKey]?.blocked ?? 0);

  const daily = lastNDayKeys(DAILY_SERIES_DAYS).map((date) => {
    const d = stats.days[date];
    return { date, reads: d?.reads ?? 0, blocked: d?.blocked ?? 0, empty: d?.empty ?? 0 };
  });

  // Per-folder aggregate over the last 7 days.
  const windowKeys = lastNDayKeys(FOLDER_WINDOW_DAYS);
  const folderAgg = new Map<string, { name: string; reads: number; empty: number; blocked: number }>();
  for (const key of windowKeys) {
    const day = stats.days[key];
    if (!day) continue;
    for (const [fid, fb] of Object.entries(day.folders)) {
      const cur = folderAgg.get(fid) ?? { name: fb.name, reads: 0, empty: 0, blocked: 0 };
      cur.name = fb.name;
      cur.reads += fb.reads;
      cur.empty += fb.empty;
      cur.blocked += fb.blocked;
      folderAgg.set(fid, cur);
    }
  }
  // Include current IG folders that haven't run yet, so the volume view is complete.
  for (const [fid] of profilesByFolder) {
    if (!folderAgg.has(fid)) folderAgg.set(fid, { name: paths.get(fid) ?? '—', reads: 0, empty: 0, blocked: 0 });
  }

  const folderRows = Array.from(folderAgg.entries())
    .map(([folderId, agg]) => {
      const profiles = profilesByFolder.get(folderId) ?? 0;
      let signal: FolderSignal = 'ok';
      let note = 'Volume ok';
      if (agg.blocked > 0) {
        signal = 'problem';
        note = `${agg.blocked} bloqueio(s) em 7 dias`;
      } else if (profiles >= 13) {
        signal = 'high';
        note = 'Pasta grande — rodada longa (considere dividir)';
      } else if (agg.reads > 0 && agg.empty / agg.reads >= 0.5) {
        signal = 'high';
        note = 'Muitos perfis sem posts (candidatos a deixar de seguir)';
      }
      return {
        folderId,
        name: paths.get(folderId) ?? agg.name,
        profiles,
        reads7d: agg.reads,
        empty7d: agg.empty,
        blocked7d: agg.blocked,
        signal,
        note,
      };
    })
    .sort((a, b) => b.profiles - a.profiles);

  // Risk level: blocks dominate; volume is secondary context.
  let level: RiskLevel = 'safe';
  let label = 'Seguro';
  let reason = 'Volume dentro do normal e sem bloqueios recentes.';
  if (blocks48h >= 3) {
    level = 'risk';
    label = 'Risco';
    reason = `${blocks48h} bloqueios nas últimas 48h — reduza o volume ou aumente o espaçamento.`;
  } else if (blocks48h >= 1) {
    level = 'attention';
    label = 'Atenção';
    reason = `${blocks48h} bloqueio(s) nas últimas 48h — você está perto do limite.`;
  } else if (todayBucket.reads > ATTENTION_READS_PER_DAY) {
    level = 'attention';
    label = 'Atenção';
    reason = `Volume alto hoje (${todayBucket.reads} leituras) — de olho, mas sem bloqueios.`;
  }

  return {
    hasData,
    updatedAt: stats.updatedAt || null,
    today: { reads: todayBucket.reads, ok: todayBucket.ok, empty: todayBucket.empty, blocked: todayBucket.blocked },
    blocks48h,
    risk: { level, label, reason },
    daily,
    folders: folderRows,
    thresholds: { safePerDay: SAFE_READS_PER_DAY, attentionPerDay: ATTENTION_READS_PER_DAY },
  };
}
