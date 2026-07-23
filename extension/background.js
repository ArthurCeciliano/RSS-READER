// ---------------------------------------------------------------------------
// Folder-based Instagram scheduling.
//
// Instead of "sync everything that's due every 25 min" (a burst that got the
// account rate-limited), each folder gets its own times of day. A lightweight
// tick alarm wakes every few minutes, checks the clock, and runs AT MOST ONE
// folder whose scheduled slot has passed — one profile at a time, widely
// spaced. Folder membership is discovered live from GET /api/folders, so the
// schedule always tracks the real folders with no backend changes.
// ---------------------------------------------------------------------------

const SCHEDULE_TICK_ALARM = 'ig-schedule-tick';
const LEGACY_ALARM = 'ig-sync';
const TICK_PERIOD_MINUTES = 10;

// Daily window the auto-generated schedule spreads slots across (08:00–20:00),
// in minutes-since-midnight, plus how many slots each folder gets per day.
const WINDOW_START_MIN = 8 * 60;
const WINDOW_END_MIN = 20 * 60;
const SLOTS_PER_FOLDER = 2;

const TAB_LOAD_TIMEOUT_MS = 20000;
const GRID_POLL_TIMEOUT_MS = 12000;
const RELOAD_RETRY_POLL_TIMEOUT_MS = 15000;
const INBOX_POLL_TIMEOUT_MS = 8000;

// Long randomized gap between profiles so a folder run is never a burst.
const MIN_GAP_MS = 20000;
const MAX_GAP_MS = 45000;

// Per-source exponential backoff (capped) so a consistently failing profile
// isn't re-opened every run.
const BLOCKED_BACKOFF_BASE_MS = 30 * 60 * 1000;
const EMPTY_BACKOFF_BASE_MS = 10 * 60 * 1000;
const BACKOFF_MAX_MS = 12 * 60 * 60 * 1000;

// Several blocks inside one folder run = the whole session is throttled, not
// those profiles. Stop and cool the entire extension down.
const BLOCK_THRESHOLD = 2;
const GLOBAL_COOLDOWN_MS = 2 * 60 * 60 * 1000;

// DMs piggyback on a completed folder run, but no more than once every few hours.
const DM_MIN_INTERVAL_MS = 4 * 60 * 60 * 1000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function minutesToHHMM(min) {
  const m = ((min % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

function usernameFromIdentity(url) {
  try {
    const path = new URL(url).pathname.replace(/^\/|\/$/g, '');
    return path.split('/')[0] || null;
  } catch {
    return null;
  }
}

function waitForTabComplete(tabId) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, TAB_LOAD_TIMEOUT_MS);
    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

/**
 * Runs INSIDE a real instagram.com tab via chrome.scripting.executeScript.
 * Reads posts straight out of the already-rendered grid (post links + each
 * thumbnail's alt text) — no extra network request of our own, which IG 429s
 * even from the same-origin tab with the real session.
 *
 * Returns one of:
 *   { items, hasActiveStory }        -- posts read successfully
 *   { blocked: true, reason, ... }   -- Instagram error/challenge/login wall
 *   { empty: true, hasActiveStory }  -- loaded fine but no posts (private/empty)
 *   { error }                        -- unexpected exception in the page
 * The blocked/empty distinction is what lets the loop back off from a real
 * rate-limit instead of hammering a genuinely empty profile.
 */
function scrapeProfileGridInPage(username, pollTimeoutMs) {
  return (async () => {
    try {
      function collectPosts() {
        const seen = new Set();
        const posts = [];
        document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]').forEach((a) => {
          const match = a.getAttribute('href')?.match(/\/(p|reel)\/([A-Za-z0-9_-]+)/);
          if (!match) return;
          const shortcode = match[2];
          if (seen.has(shortcode)) return;
          seen.add(shortcode);
          const img = a.querySelector('img');
          posts.push({ shortcode, alt: img?.getAttribute('alt') || '', imageUrl: img?.src || undefined });
        });
        return posts;
      }

      // Only consulted when zero posts rendered, so caption text can't false-positive a real grid.
      function detectBlockReason() {
        const path = location.pathname;
        if (path.includes('/challenge')) return 'challenge';
        if (path.startsWith('/accounts/login')) return 'login_redirect';
        const text = document.body?.innerText || '';
        const markers = [
          'Ocorreu um erro',
          'Algo deu errado',
          'Something went wrong',
          'Algo salió mal',
          'Tentar novamente',
          'Try again',
          'Reintentar',
          'Recarregar a página',
          'Reload page',
        ];
        if (markers.some((m) => text.includes(m))) return 'error_ui';
        return null;
      }

      // No active story: the avatar <img> sits directly inside a real link
      // (<a href="/username/">). With an active story it's wrapped in a <span>.
      function hasActiveStoryRing() {
        const header = document.querySelector('header') || document.querySelector('main');
        const avatarImg = header?.querySelector('img');
        if (!avatarImg) return false;
        return avatarImg.parentElement?.tagName !== 'A';
      }

      const deadline = Date.now() + pollTimeoutMs;
      let posts = collectPosts();
      while (posts.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        posts = collectPosts();
      }
      const hasActiveStory = hasActiveStoryRing();

      if (posts.length === 0) {
        const reason = detectBlockReason();
        if (reason) return { blocked: true, reason, hasActiveStory };
        return { empty: true, hasActiveStory };
      }

      const items = posts.map((p) => {
        const caption = p.alt || '';
        const firstLine = caption ? caption.split('\n', 1)[0] : '';
        return {
          guid: p.shortcode,
          link: `https://www.instagram.com/p/${p.shortcode}/`,
          title: firstLine ? firstLine.slice(0, 120) : '(sem legenda)',
          summary: caption,
          imageUrl: p.imageUrl,
          author: username,
        };
      });
      return { items, hasActiveStory };
    } catch (err) {
      return { error: String(err?.message ?? err) };
    }
  })();
}

/**
 * Runs INSIDE instagram.com/direct/inbox/. Mirrors the sender + preview snippet
 * already visible — never opens a thread (which would mark it "seen").
 */
function scrapeDmInboxInPage(pollTimeoutMs) {
  return (async () => {
    try {
      function collect() {
        const container = document.querySelector('[data-pagelet="IGDInboxThreadListScrollableAreaPagelet"]') || document.body;
        const seen = new Set();
        const conversations = [];
        container.querySelectorAll('span[title]').forEach((nameSpan) => {
          const senderName = nameSpan.getAttribute('title');
          if (!senderName || seen.has(senderName)) return;
          let row = nameSpan;
          while (row && row.parentElement && !row.querySelector('img')) row = row.parentElement;
          if (!row) return;
          const avatarUrl = row.querySelector('img')?.src;
          const rawText = (row.textContent || '').replace(senderName, '').trim();
          const dotIndex = rawText.lastIndexOf('·');
          const previewText = (dotIndex === -1 ? rawText : rawText.slice(0, dotIndex)).trim();
          if (!previewText) return;
          seen.add(senderName);
          conversations.push({ senderName, previewText, avatarUrl });
        });
        return conversations;
      }

      const deadline = Date.now() + pollTimeoutMs;
      let conversations = collect();
      while (conversations.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        conversations = collect();
      }
      return { conversations };
    } catch (err) {
      return { error: String(err?.message ?? err) };
    }
  })();
}

async function getConfig() {
  const { apiBaseUrl, apiToken } = await chrome.storage.local.get(['apiBaseUrl', 'apiToken']);
  return { apiBaseUrl: apiBaseUrl || '', apiToken: apiToken || '' };
}

async function getState() {
  const s = await chrome.storage.local.get([
    'sourceBackoff',
    'globalCooldownUntil',
    'folderLastRun',
    'folderRuns',
    'dmLastRun',
  ]);
  return {
    sourceBackoff: s.sourceBackoff || {},
    globalCooldownUntil: s.globalCooldownUntil || 0,
    folderLastRun: s.folderLastRun || {},
    folderRuns: s.folderRuns || {},
    dmLastRun: s.dmLastRun || 0,
  };
}

// --- API helpers -----------------------------------------------------------

/** Walks GET /api/folders into a flat list of folders that hold >=1 Instagram source. */
async function fetchIgFolders(apiBaseUrl, apiToken) {
  const res = await fetch(`${apiBaseUrl}/api/folders`, { headers: { 'X-Extension-Token': apiToken } });
  if (!res.ok) throw new Error(`GET /api/folders failed: ${res.status}`);
  const { folders } = await res.json();
  const out = [];
  function walk(nodes, prefix) {
    for (const n of nodes || []) {
      const path = prefix ? `${prefix} / ${n.name}` : n.name;
      const igSources = (n.sources || [])
        .filter((s) => s.type === 'instagram')
        .map((s) => ({ sourceId: s.id, username: usernameFromIdentity(s.identityUrl) }))
        .filter((s) => s.username);
      if (igSources.length > 0) out.push({ folderId: n.id, name: path, sources: igSources });
      if (n.children?.length) walk(n.children, path);
    }
  }
  walk(folders, '');
  return out;
}

async function runProfileScrape(tabId, username, pollMs) {
  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId },
    func: scrapeProfileGridInPage,
    args: [username, pollMs],
  });
  return result || { error: 'no result from page script' };
}

/** Opens the profile, scrapes it, reloads+retries once on a transient error. */
async function fetchInstagramProfileItems(username) {
  const tab = await chrome.tabs.create({ url: `https://www.instagram.com/${encodeURIComponent(username)}/`, active: false });
  try {
    await waitForTabComplete(tab.id);
    let result = await runProfileScrape(tab.id, username, GRID_POLL_TIMEOUT_MS);

    if (!result.items && (result.blocked || result.empty)) {
      await delay(1500 + Math.random() * 1500);
      await chrome.tabs.reload(tab.id);
      await waitForTabComplete(tab.id);
      result = await runProfileScrape(tab.id, username, RELOAD_RETRY_POLL_TIMEOUT_MS);
    }

    if (result.items) return { status: 'ok', items: result.items, hasActiveStory: result.hasActiveStory };
    if (result.blocked) return { status: 'blocked', reason: result.reason, hasActiveStory: result.hasActiveStory };
    if (result.empty) return { status: 'empty', hasActiveStory: result.hasActiveStory };
    return { status: 'blocked', reason: result.error || 'unknown' };
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function pushItems(apiBaseUrl, apiToken, sourceId, items, hasActiveStory) {
  const res = await fetch(`${apiBaseUrl}/api/extension/instagram/${sourceId}/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Extension-Token': apiToken },
    body: JSON.stringify({ items, hasActiveStory }),
  });
  if (!res.ok) throw new Error(`push items failed: ${res.status}`);
  return res.json();
}

/**
 * Cross-device guard, checked right before opening any Instagram tab for a
 * folder. The schedule is shared server-side, but this extension can be
 * installed on more than one browser/machine, each ticking independently —
 * without this, two devices (or a service-worker restart racing the next
 * tick on the same device) can both decide "this folder's slot has passed"
 * within minutes of each other and double up the traffic to it. Fails OPEN
 * (treated as claimed) on any network/HTTP error, including a 404 from an
 * older backend that hasn't picked up this route yet — the per-device guard
 * in runScheduleTick/syncFolderNow already covers that case locally.
 */
async function claimFolderRunOnServer(apiBaseUrl, apiToken, folderId) {
  try {
    const res = await fetch(`${apiBaseUrl}/api/extension/instagram/folders/${encodeURIComponent(folderId)}/claim-run`, {
      method: 'POST',
      headers: { 'X-Extension-Token': apiToken },
    });
    if (!res.ok) return true;
    const { claimed } = await res.json();
    return claimed !== false;
  } catch {
    return true;
  }
}

async function fetchDmInbox() {
  const tab = await chrome.tabs.create({ url: 'https://www.instagram.com/direct/inbox/', active: false });
  try {
    await waitForTabComplete(tab.id);
    const [{ result } = {}] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scrapeDmInboxInPage,
      args: [INBOX_POLL_TIMEOUT_MS],
    });
    if (!result) throw new Error('no result from page script');
    if (result.error) throw new Error(result.error);
    return result.conversations;
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function pushDmInbox(apiBaseUrl, apiToken, conversations) {
  const res = await fetch(`${apiBaseUrl}/api/extension/instagram/dm-inbox`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Extension-Token': apiToken },
    body: JSON.stringify({ conversations }),
  });
  if (!res.ok) throw new Error(`push dm-inbox failed: ${res.status}`);
  return res.json();
}

/** Fire-and-forget telemetry for the risk dashboard — never fails a folder run. */
async function reportReadLog(apiBaseUrl, apiToken, folder, summary) {
  try {
    await fetch(`${apiBaseUrl}/api/extension/instagram/read-log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Extension-Token': apiToken },
      body: JSON.stringify({
        folderId: folder.folderId,
        folderName: folder.name,
        ok: summary.okCount,
        empty: summary.emptyCount,
        blocked: summary.blockedCount,
        newItems: summary.newTotal,
      }),
    });
  } catch {
    /* telemetry is best-effort */
  }
}

// --- Scheduling ------------------------------------------------------------

/** Two evenly-spread slots for folder #i of n, both inside the daily window. */
function defaultTimesForIndex(i, n) {
  const span = WINDOW_END_MIN - WINDOW_START_MIN; // e.g. 720 min
  const half = Math.floor(span / SLOTS_PER_FOLDER); // gap between a folder's two slots
  const step = n > 1 ? Math.floor(half / n) : 0; // stagger first slots across the first half
  const first = WINDOW_START_MIN + step * i;
  return [minutesToHHMM(first), minutesToHHMM(first + half)];
}

/** Fills in defaults for any folder without an explicit schedule, and drops removed folders. */
function ensureScheduleDefaults(schedule, folders) {
  const sorted = [...folders].sort((a, b) => a.name.localeCompare(b.name));
  const next = {};
  sorted.forEach((f, i) => {
    const existing = schedule?.[f.folderId];
    next[f.folderId] = existing && existing.length ? existing : defaultTimesForIndex(i, sorted.length);
  });
  return next;
}

/**
 * The schedule is owned by the web app (Configurações → Agendamento por pasta),
 * stored as the `instagramFolderSchedule` setting. The extension only reads it,
 * so one config controls every machine. Falls back to a local cache when the
 * server is unreachable, and fills auto-defaults for folders not configured yet
 * (e.g. a folder created after the last save) so they still get sensible times.
 */
async function loadSchedule(apiBaseUrl, apiToken, folders) {
  let serverSchedule = null;
  try {
    const res = await fetch(`${apiBaseUrl}/api/settings`, { headers: { 'X-Extension-Token': apiToken } });
    if (res.ok) {
      const settings = await res.json();
      serverSchedule = settings.instagramFolderSchedule || {};
    }
  } catch {
    /* fall back to cache below */
  }

  if (serverSchedule === null) {
    const { folderScheduleCache } = await chrome.storage.local.get(['folderScheduleCache']);
    serverSchedule = folderScheduleCache || {};
  } else {
    await chrome.storage.local.set({ folderScheduleCache: serverSchedule });
  }

  return ensureScheduleDefaults(serverSchedule, folders);
}

/** Epoch ms of the most recent scheduled slot today that has already passed, else null. */
function lastPassedSlotToday(times, nowMs) {
  let best = null;
  for (const t of times) {
    const [h, m] = t.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) continue;
    const d = new Date(nowMs);
    d.setHours(h, m, 0, 0);
    const ts = d.getTime();
    if (ts <= nowMs && (best === null || ts > best)) best = ts;
  }
  return best;
}

/** Next exponential-backoff window for a source, capped. */
function nextBackoff(prev, now, baseMs) {
  const failCount = (prev?.failCount || 0) + 1;
  const delayMs = Math.min(baseMs * 2 ** (failCount - 1), BACKOFF_MAX_MS);
  return { failCount, nextRetryAt: now + delayMs };
}

/**
 * Runs one list of {sourceId, username} with the cautious pacing. Mutates
 * `state.sourceBackoff` / `state.globalCooldownUntil`. Returns a summary and
 * whether it ran to completion (false only if it tripped the global cooldown).
 */
async function syncSourceList(apiBaseUrl, apiToken, list, state) {
  const results = [];
  let blockedThisRun = 0;
  let completed = true;
  let newTotal = 0;
  const now = Date.now();

  const eligible = list.filter((s) => !(state.sourceBackoff[s.sourceId] && state.sourceBackoff[s.sourceId].nextRetryAt > now));

  for (const { sourceId, username } of eligible) {
    let outcome;
    try {
      outcome = await fetchInstagramProfileItems(username);
    } catch (err) {
      outcome = { status: 'blocked', reason: String(err?.message ?? err) };
    }

    if (outcome.status === 'ok') {
      try {
        const { newItemCount } = await pushItems(apiBaseUrl, apiToken, sourceId, outcome.items, outcome.hasActiveStory);
        newTotal += newItemCount || 0;
        results.push({ username, status: 'ok', newItemCount, hasActiveStory: outcome.hasActiveStory });
        delete state.sourceBackoff[sourceId];
      } catch (err) {
        results.push({ username, status: 'error', error: String(err?.message ?? err) });
      }
    } else if (outcome.status === 'empty') {
      results.push({ username, status: 'empty', error: 'sem posts visíveis' });
      state.sourceBackoff[sourceId] = nextBackoff(state.sourceBackoff[sourceId], Date.now(), EMPTY_BACKOFF_BASE_MS);
    } else {
      blockedThisRun += 1;
      results.push({ username, status: 'blocked', error: `bloqueado (${outcome.reason})` });
      state.sourceBackoff[sourceId] = nextBackoff(state.sourceBackoff[sourceId], Date.now(), BLOCKED_BACKOFF_BASE_MS);
      if (blockedThisRun >= BLOCK_THRESHOLD) {
        state.globalCooldownUntil = Date.now() + GLOBAL_COOLDOWN_MS;
        completed = false;
        break;
      }
    }

    await delay(MIN_GAP_MS + Math.random() * (MAX_GAP_MS - MIN_GAP_MS));
  }

  const okCount = results.filter((r) => r.status === 'ok').length;
  const blockedCount = results.filter((r) => r.status === 'blocked').length;
  const emptyCount = results.filter((r) => r.status === 'empty').length;
  return { results, completed, newTotal, okCount, blockedCount, emptyCount, skipped: list.length - eligible.length };
}

/** Runs a single folder end-to-end and records its outcome + a compact summary. */
async function runFolder(apiBaseUrl, apiToken, folder, state) {
  const summary = await syncSourceList(apiBaseUrl, apiToken, folder.sources, state);

  // Telemetry for the risk dashboard: report the actual reads this run made.
  if (summary.okCount + summary.emptyCount + summary.blockedCount > 0) {
    await reportReadLog(apiBaseUrl, apiToken, folder, summary);
  }

  if (summary.completed) {
    state.folderLastRun[folder.folderId] = Date.now();
    // Piggyback DMs onto a completed run, throttled, and never right after a throttle.
    if (state.globalCooldownUntil <= Date.now() && Date.now() - state.dmLastRun > DM_MIN_INTERVAL_MS) {
      try {
        const conversations = await fetchDmInbox();
        await pushDmInbox(apiBaseUrl, apiToken, conversations);
        state.dmLastRun = Date.now();
      } catch {
        /* DM scrape is best-effort; never fails a folder run. */
      }
    }
  }

  state.folderRuns[folder.folderId] = {
    at: new Date().toISOString(),
    folderName: folder.name,
    ok: summary.okCount,
    newTotal: summary.newTotal,
    empty: summary.emptyCount,
    blocked: summary.blockedCount,
    completed: summary.completed,
  };

  await chrome.storage.local.set({
    sourceBackoff: state.sourceBackoff,
    globalCooldownUntil: state.globalCooldownUntil,
    folderLastRun: state.folderLastRun,
    folderRuns: state.folderRuns,
    dmLastRun: state.dmLastRun,
    lastRun: {
      at: new Date().toISOString(),
      folderName: folder.name,
      error: summary.completed ? null : 'Instagram limitou a sessão — pausando por 2h',
      results: summary.results,
    },
  });

  return summary;
}

/** The heartbeat: pick at most one due folder and run it. */
async function runScheduleTick() {
  const { apiBaseUrl, apiToken } = await getConfig();
  if (!apiBaseUrl || !apiToken) {
    await chrome.storage.local.set({ lastRun: { at: new Date().toISOString(), error: 'not configured', results: [] } });
    return;
  }

  const state = await getState();
  const now = Date.now();
  if (now < state.globalCooldownUntil) return; // session cooling down; skip silently.

  let folders;
  try {
    folders = await fetchIgFolders(apiBaseUrl, apiToken);
  } catch (err) {
    await chrome.storage.local.set({ lastRun: { at: new Date().toISOString(), error: String(err?.message ?? err), results: [] } });
    return;
  }

  const schedule = await loadSchedule(apiBaseUrl, apiToken, folders);

  // Among folders whose slot has passed and hasn't run since, pick the most overdue (earliest slot).
  let pick = null;
  let pickSlot = Infinity;
  for (const folder of folders) {
    const times = schedule[folder.folderId];
    if (!times || times.length === 0) continue;
    const slot = lastPassedSlotToday(times, now);
    if (slot === null) continue;
    if ((state.folderLastRun[folder.folderId] || 0) < slot && slot < pickSlot) {
      pick = folder;
      pickSlot = slot;
    }
  }

  if (!pick) return;

  // Mark this slot as handled by THIS device immediately — persisted before
  // any tab opens — so a service-worker restart mid-run (Chrome can kill an
  // MV3 background script during the plain setTimeout gaps between profiles,
  // since that's not a chrome.* call that keeps it alive) doesn't make the
  // next 10-minute tick think the slot is still pending and reopen profiles
  // we just visited. Marked unconditionally, whether or not the run below
  // actually goes ahead, so this device never re-asks for the same slot.
  state.folderLastRun[pick.folderId] = now;
  await chrome.storage.local.set({ folderLastRun: state.folderLastRun });

  const claimed = await claimFolderRunOnServer(apiBaseUrl, apiToken, pick.folderId);
  if (claimed) await runFolder(apiBaseUrl, apiToken, pick, state);
}

async function syncFolderNow(folderId) {
  const { apiBaseUrl, apiToken } = await getConfig();
  if (!apiBaseUrl || !apiToken) return { ok: false, error: 'not configured' };

  const state = await getState();
  state.globalCooldownUntil = 0; // explicit user action clears any cooldown.

  let folders;
  try {
    folders = await fetchIgFolders(apiBaseUrl, apiToken);
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) };
  }
  const folder = folders.find((f) => f.folderId === folderId);
  if (!folder) return { ok: false, error: 'folder not found' };

  // Same cross-device guard as the scheduled path: a manual "Sincronizar"
  // click on one device shouldn't double up with another device's click (or
  // its own scheduled run) landing around the same time.
  const claimed = await claimFolderRunOnServer(apiBaseUrl, apiToken, folderId);
  if (!claimed) return { ok: false, error: 'já sincronizando em outro dispositivo/sessão — tenta de novo em alguns minutos' };

  const summary = await runFolder(apiBaseUrl, apiToken, folder, state);
  return { ok: true, summary: { newTotal: summary.newTotal, ok: summary.okCount, blocked: summary.blockedCount } };
}

/** Folders + effective schedule + status, for the options/popup UIs. */
async function getPlan() {
  const { apiBaseUrl, apiToken } = await getConfig();
  if (!apiBaseUrl || !apiToken) return { configured: false, folders: [] };

  const state = await getState();
  const folders = await fetchIgFolders(apiBaseUrl, apiToken);
  const schedule = await loadSchedule(apiBaseUrl, apiToken, folders);

  return {
    configured: true,
    globalCooldownUntil: state.globalCooldownUntil,
    folders: folders.map((f) => ({
      folderId: f.folderId,
      name: f.name,
      count: f.sources.length,
      times: schedule[f.folderId] || [],
      lastRun: state.folderRuns[f.folderId] || null,
    })),
  };
}

// --- Alarms & messaging ----------------------------------------------------

async function scheduleAlarm() {
  await chrome.alarms.clear(LEGACY_ALARM).catch(() => {});
  await chrome.alarms.create(SCHEDULE_TICK_ALARM, { periodInMinutes: TICK_PERIOD_MINUTES, delayInMinutes: 1 });
}

chrome.runtime.onInstalled.addListener(scheduleAlarm);
chrome.runtime.onStartup.addListener(scheduleAlarm);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SCHEDULE_TICK_ALARM) runScheduleTick();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'get-plan') {
    getPlan().then((plan) => sendResponse(plan)).catch((err) => sendResponse({ configured: false, error: String(err?.message ?? err), folders: [] }));
    return true;
  }
  if (message?.type === 'sync-folder') {
    syncFolderNow(message.folderId).then((r) => sendResponse(r));
    return true;
  }
  if (message?.type === 'reschedule') {
    scheduleAlarm().then(() => sendResponse({ ok: true }));
    return true;
  }
  return undefined;
});

// Lets the RSS Reader web page (externally_connectable) trigger a folder sync.
chrome.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'sync-folder' && message.folderId) {
    syncFolderNow(message.folderId).then((r) => sendResponse(r));
    return true;
  }
  return undefined;
});
