// ---------------------------------------------------------------------------
// Instagram bridge — post-page reading, alarm-driven queue.
//
// RELIABILITY MODEL (why this shape):
// MV3 service workers get killed after ~30s idle. A folder run must wait 1–3.5
// min between profiles, so it CANNOT be one long function with sleeps (the
// worker dies mid-wait, orphaning the open tab and halting the run — exactly
// the bug we saw). Instead:
//   • Work is a PERSISTENT QUEUE in chrome.storage (survives worker death).
//   • Each profile is processed in its own SHORT alarm wake (open tab, read,
//     close tab — all in ~30s, well within the worker's life).
//   • The long gap between profiles is an ALARM delay (no tab open, worker free
//     to die; the alarm revives it for the next profile).
//   • Any tab we open is recorded so a killed step's orphan is closed next wake.
// This guarantees every configured profile gets read, on schedule or on manual
// "Sincronizar", regardless of the worker being recycled.
//
// READING: Instagram blocks the profile GRID, but a POST page still loads and
// shows a "Mais posts de {user}" grid. We open a recent known post ("seed") and
// read that grid — never the blocked profile. Sources with no seed are SKIPPED
// and reported (we never open the blocked profile surface automatically).
// ---------------------------------------------------------------------------

const SCHEDULE_TICK_ALARM = 'ig-schedule-tick';
const WORKER_ALARM = 'ig-worker';
const LEGACY_ALARM = 'ig-sync';
const TICK_PERIOD_MINUTES = 5;

const WINDOW_START_MIN = 8 * 60;
const WINDOW_END_MIN = 20 * 60;
const SLOTS_PER_FOLDER = 3;

const TAB_LOAD_TIMEOUT_MS = 20000;
const GRID_POLL_TIMEOUT_MS = 12000;
const RELOAD_RETRY_POLL_TIMEOUT_MS = 15000;
const INBOX_POLL_TIMEOUT_MS = 8000;

// Human-like randomized gap between profiles (e.g. 1:33, 2:01), applied as the
// delay of the NEXT worker alarm. Chrome clamps alarms to ~30s min, so keep min
// comfortably above it.
const MIN_GAP_MS = 60000; // 1:00
const MAX_GAP_MS = 210000; // 3:30

const BLOCKED_BACKOFF_BASE_MS = 30 * 60 * 1000;
const EMPTY_BACKOFF_BASE_MS = 20 * 60 * 1000;
const BACKOFF_MAX_MS = 12 * 60 * 60 * 1000;

// Post-page reads should rarely block; allow a few before concluding the whole
// session is throttled (vs. one stray hiccup halting everything).
const BLOCK_THRESHOLD = 3;
const GLOBAL_COOLDOWN_MS = 90 * 60 * 1000;

const DM_MIN_INTERVAL_MS = 4 * 60 * 60 * 1000;

// DMs are the only feature that still needs Instagram directly. While detection
// runs "Google-only" (to keep the account fully clear of IG), keep this off.
// Flip to true to re-enable the Mensagens sync once the account is healthy.
const ENABLE_DM_INBOX = false;

// Abandon a work queue that clearly stalled so the scheduler isn't blocked.
const MAX_RUN_MS = 2 * 60 * 60 * 1000;

function pad2(n) {
  return String(n).padStart(2, '0');
}
function minutesToHHMM(min) {
  const m = ((min % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}
function randInt(min, max) {
  return Math.floor(min + Math.random() * (max - min));
}
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

// --- Tab bookkeeping (so a killed step's orphan tab gets cleaned up) --------

async function openTrackedTab(url) {
  const tab = await chrome.tabs.create({ url, active: false });
  await chrome.storage.local.set({ openTabId: tab.id });
  return tab;
}
async function closeTrackedTab(tabId) {
  await chrome.tabs.remove(tabId).catch(() => {});
  const { openTabId } = await chrome.storage.local.get('openTabId');
  if (openTabId === tabId) await chrome.storage.local.remove('openTabId');
}
/** Closes a tab left open by a previous worker step the SW was killed inside. */
async function cleanupStrayTab() {
  const { openTabId } = await chrome.storage.local.get('openTabId');
  if (openTabId != null) {
    await chrome.tabs.remove(openTabId).catch(() => {});
    await chrome.storage.local.remove('openTabId');
  }
}

// --- Page script (runs INSIDE the post page) -------------------------------

function scrapePostPageInPage(username, pollTimeoutMs) {
  return (async () => {
    const user = String(username || '').toLowerCase();
    try {
      function detectUnavailable() {
        const t = document.body?.innerText || '';
        return /n[ãa]o est[áa] dispon[íi]vel|isn'?t available|no est[áa] disponible|Página não disponível/i.test(t);
      }
      function detectBlockReason() {
        const path = location.pathname;
        if (path.includes('/challenge')) return 'challenge';
        if (path.startsWith('/accounts/login')) return 'login_redirect';
        const text = document.body?.innerText || '';
        const markers = ['Ocorreu um erro', 'Algo deu errado', 'Something went wrong', 'Algo salió mal', 'Tentar novamente', 'Try again', 'Reintentar', 'Recarregar a página', 'Reload page'];
        if (markers.some((m) => text.includes(m))) return 'error_ui';
        return null;
      }
      function collect() {
        const seen = new Set();
        const posts = [];
        document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]').forEach((a) => {
          const href = a.getAttribute('href') || '';
          const m = href.match(/\/(?:([^/]+)\/)?(p|reel)\/([A-Za-z0-9_-]+)/);
          if (!m) return;
          const owner = m[1] && m[1] !== 'p' && m[1] !== 'reel' ? m[1].toLowerCase() : null;
          const img = a.querySelector('img');
          posts.push({ owner, shortcode: m[3], alt: img?.getAttribute('alt') || '', imageUrl: img?.src || undefined });
        });
        const scoped = posts.filter((p) => p.owner === user);
        const pool = scoped.length ? scoped : posts;
        const out = [];
        for (const p of pool) {
          if (seen.has(p.shortcode)) continue;
          seen.add(p.shortcode);
          out.push(p);
        }
        return out;
      }
      function hasActiveStoryRing() {
        const authorLink = document.querySelector(`a[href="/${user}/"]`);
        const avatarImg = authorLink?.querySelector('img') || document.querySelector('header img') || document.querySelector('article img');
        if (!avatarImg) return false;
        const near = avatarImg.closest('div');
        return Boolean(near && near.querySelector('canvas'));
      }

      const deadline = Date.now() + pollTimeoutMs;
      let posts = collect();
      while (posts.length === 0 && Date.now() < deadline) {
        if (detectUnavailable()) return { unavailable: true };
        await new Promise((r) => setTimeout(r, 500));
        posts = collect();
      }
      const hasActiveStory = hasActiveStoryRing();
      if (posts.length === 0) {
        if (detectUnavailable()) return { unavailable: true };
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
 * Runs on a Google results page (google.com/search?q={user}+instagram&tbs=qdr:w).
 * Google indexes Instagram posts, so we detect new ones HERE — off Instagram's
 * rate-limited surface. Critically: results are mixed-owner (mentions, other
 * accounts), so we keep ONLY posts whose "Instagram · {owner}" label matches the
 * target username — his own posts, never someone else's action about him.
 */
function scrapeGoogleResultsInPage(username, pollTimeoutMs) {
  return (async () => {
    const target = String(username || '').toLowerCase();
    try {
      function detectCaptcha() {
        const t = (document.body?.innerText || '').toLowerCase();
        return (
          location.pathname.includes('/sorry') ||
          /unusual traffic|tráfego incomum|not a robot|sistemas detectaram|recaptcha|sou um rob/i.test(t)
        );
      }
      function collect() {
        const seen = new Set();
        const out = [];
        for (const a of document.querySelectorAll('a[href]')) {
          const href = a.href || '';
          const m = href.match(/instagram\.com\/(?:[^/]+\/)?(p|reel)\/([A-Za-z0-9_-]+)/);
          if (!m) continue;
          const shortcode = m[2];
          if (seen.has(shortcode)) continue;
          // Walk up to the result card and read its "Instagram · owner" label.
          let container = a;
          let owner = null;
          for (let i = 0; i < 8 && container; i++) {
            const mm = (container.innerText || '').match(/Instagram\s*[·•]\s*([A-Za-z0-9_.]+)/);
            if (mm) {
              owner = mm[1].toLowerCase();
              break;
            }
            container = container.parentElement;
          }
          if (owner !== target) continue; // assertive: only the profile OWNER's posts
          seen.add(shortcode);
          const h3 = container && container.querySelector('h3');
          const caption = ((h3 && h3.textContent) || a.textContent || '').trim().replace(/Instagram\s*[·•].*$/, '').trim();
          out.push({ shortcode, caption: caption.slice(0, 300) });
        }
        return out;
      }

      const deadline = Date.now() + pollTimeoutMs;
      let posts = collect();
      while (posts.length === 0 && Date.now() < deadline) {
        if (detectCaptcha()) return { blocked: true, reason: 'google_captcha' };
        await new Promise((r) => setTimeout(r, 500));
        posts = collect();
      }
      if (posts.length === 0) {
        if (detectCaptcha()) return { blocked: true, reason: 'google_captcha' };
        return { empty: true };
      }
      const items = posts.map((p) => {
        const firstLine = p.caption ? p.caption.split('\n', 1)[0] : '';
        return {
          guid: p.shortcode,
          link: `https://www.instagram.com/p/${p.shortcode}/`,
          title: firstLine ? firstLine.slice(0, 120) : p.caption ? p.caption.slice(0, 120) : '(sem legenda)',
          summary: p.caption,
          author: username,
        };
      });
      return { items };
    } catch (err) {
      return { error: String(err?.message ?? err) };
    }
  })();
}

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

// --- Config / state --------------------------------------------------------

async function getConfig() {
  const { apiBaseUrl, apiToken } = await chrome.storage.local.get(['apiBaseUrl', 'apiToken']);
  return { apiBaseUrl: apiBaseUrl || '', apiToken: apiToken || '' };
}
async function getState() {
  const s = await chrome.storage.local.get(['sourceBackoff', 'globalCooldownUntil', 'folderLastRun', 'folderRuns', 'dmLastRun']);
  return {
    sourceBackoff: s.sourceBackoff || {},
    globalCooldownUntil: s.globalCooldownUntil || 0,
    folderLastRun: s.folderLastRun || {},
    folderRuns: s.folderRuns || {},
    dmLastRun: s.dmLastRun || 0,
  };
}
async function persistState(state) {
  await chrome.storage.local.set({
    sourceBackoff: state.sourceBackoff,
    globalCooldownUntil: state.globalCooldownUntil,
    folderLastRun: state.folderLastRun,
    folderRuns: state.folderRuns,
    dmLastRun: state.dmLastRun,
  });
}
async function getWorkQueue() {
  const { workQueue } = await chrome.storage.local.get('workQueue');
  return workQueue || null;
}

// --- API + reading ---------------------------------------------------------

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

async function fetchSeeds(apiBaseUrl, apiToken) {
  try {
    const res = await fetch(`${apiBaseUrl}/api/extension/instagram/seeds`, { headers: { 'X-Extension-Token': apiToken } });
    if (!res.ok) return {};
    const { seeds } = await res.json();
    const map = {};
    for (const s of seeds || []) map[s.sourceId] = s.shortcodes || [];
    return map;
  } catch {
    return {};
  }
}

/** Cross-device guard: fails OPEN (claimed) on any error so a lone device still works. */
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

async function runPostScrape(tabId, username, pollMs) {
  // Hard cap so a hung executeScript can never leave the tab open forever —
  // whatever happens, this resolves within pollMs + 8s and the caller's finally
  // closes the tab.
  const exec = chrome.scripting
    .executeScript({ target: { tabId }, func: scrapePostPageInPage, args: [username, pollMs] })
    .then((r) => (r && r[0] ? r[0].result : undefined))
    .catch((err) => ({ error: String(err?.message ?? err) }));
  const timeout = new Promise((resolve) => setTimeout(() => resolve({ error: 'scrape_timeout' }), pollMs + 8000));
  const result = await Promise.race([exec, timeout]);
  return result || { error: 'no result from page script' };
}

/** Opens one known post page, reads its "more posts" grid. Reloads once ONLY on
 *  `empty` (slow grid) — never on a block or unavailable post. */
async function fetchViaPostPage(username, shortcode) {
  console.log(`[IG] abrindo post ${shortcode} de @${username}`);
  const tab = await openTrackedTab(`https://www.instagram.com/p/${shortcode}/`);
  try {
    await waitForTabComplete(tab.id);
    let result = await runPostScrape(tab.id, username, GRID_POLL_TIMEOUT_MS);
    if (!result.items && result.empty && !result.blocked && !result.unavailable) {
      await delay(1500 + Math.random() * 1500);
      await chrome.tabs.reload(tab.id);
      await waitForTabComplete(tab.id);
      result = await runPostScrape(tab.id, username, RELOAD_RETRY_POLL_TIMEOUT_MS);
    }
    if (result.items) return { status: 'ok', items: result.items, hasActiveStory: result.hasActiveStory };
    if (result.unavailable) return { status: 'unavailable' };
    if (result.blocked) return { status: 'blocked', reason: result.reason, hasActiveStory: result.hasActiveStory };
    if (result.empty) return { status: 'empty', hasActiveStory: result.hasActiveStory };
    return { status: 'blocked', reason: result.error || 'unknown' };
  } finally {
    await closeTrackedTab(tab.id);
    console.log(`[IG] fechou post ${shortcode}`);
  }
}

async function runGoogleScrape(tabId, username, pollMs) {
  const exec = chrome.scripting
    .executeScript({ target: { tabId }, func: scrapeGoogleResultsInPage, args: [username, pollMs] })
    .then((r) => (r && r[0] ? r[0].result : undefined))
    .catch((err) => ({ error: String(err?.message ?? err) }));
  const timeout = new Promise((resolve) => setTimeout(() => resolve({ error: 'scrape_timeout' }), pollMs + 8000));
  return (await Promise.race([exec, timeout])) || { error: 'no result from page script' };
}

/** Detects new posts via a Google search (owner-filtered), never touching
 *  Instagram. Pushes all of the owner's indexed posts; the server dedups so only
 *  genuinely new ones are ingested. */
async function fetchViaGoogle(username) {
  console.log(`[GG] buscando @${username} no Google`);
  const q = encodeURIComponent(`${username} instagram`);
  const tab = await openTrackedTab(`https://www.google.com/search?q=${q}&tbs=qdr:w&hl=pt-BR`);
  try {
    await waitForTabComplete(tab.id);
    const result = await runGoogleScrape(tab.id, username, GRID_POLL_TIMEOUT_MS);
    if (result.items && result.items.length) {
      console.log(`[GG] @${username}: ${result.items.length} post(s) do dono`);
      return { status: 'ok', items: result.items };
    }
    if (result.blocked) return { status: 'blocked', reason: result.reason };
    return { status: 'empty' };
  } finally {
    await closeTrackedTab(tab.id);
    console.log(`[GG] fechou busca @${username}`);
  }
}

/**
 * OPTION A: detect + ingest via Google search, never opening Instagram. `seeds`
 * (recent known shortcodes) and the post-page reader stay available for a future
 * fallback (option C), but are not used in the main flow.
 */
async function fetchIgItems(username, _seeds) {
  return fetchViaGoogle(username);
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

async function fetchDmInbox() {
  const tab = await openTrackedTab('https://www.instagram.com/direct/inbox/');
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
    await closeTrackedTab(tab.id);
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

async function reportReadLog(apiBaseUrl, apiToken, folderId, folderName, agg) {
  try {
    await fetch(`${apiBaseUrl}/api/extension/instagram/read-log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Extension-Token': apiToken },
      body: JSON.stringify({ folderId, folderName, ok: agg.ok, empty: agg.empty, blocked: agg.blocked, newItems: agg.newTotal }),
    });
  } catch {
    /* telemetry best-effort */
  }
}

// --- Scheduling helpers ----------------------------------------------------

function defaultTimesForIndex(i, n) {
  const span = WINDOW_END_MIN - WINDOW_START_MIN;
  const gap = Math.floor(span / SLOTS_PER_FOLDER);
  const step = n > 1 ? Math.floor(gap / n) : 0;
  const first = WINDOW_START_MIN + step * i;
  const times = [];
  for (let s = 0; s < SLOTS_PER_FOLDER; s++) times.push(minutesToHHMM(first + gap * s));
  return times;
}
function ensureScheduleDefaults(schedule, folders) {
  const sorted = [...folders].sort((a, b) => a.name.localeCompare(b.name));
  const next = {};
  sorted.forEach((f, i) => {
    const existing = schedule?.[f.folderId];
    next[f.folderId] = existing && existing.length ? existing : defaultTimesForIndex(i, sorted.length);
  });
  return next;
}
async function loadSchedule(apiBaseUrl, apiToken, folders) {
  let serverSchedule = null;
  try {
    const res = await fetch(`${apiBaseUrl}/api/settings`, { headers: { 'X-Extension-Token': apiToken } });
    if (res.ok) {
      const settings = await res.json();
      serverSchedule = settings.instagramFolderSchedule || {};
    }
  } catch {
    /* cache below */
  }
  if (serverSchedule === null) {
    const { folderScheduleCache } = await chrome.storage.local.get(['folderScheduleCache']);
    serverSchedule = folderScheduleCache || {};
  } else {
    await chrome.storage.local.set({ folderScheduleCache: serverSchedule });
  }
  return ensureScheduleDefaults(serverSchedule, folders);
}
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
function nextBackoff(prev, now, baseMs) {
  const failCount = (prev?.failCount || 0) + 1;
  const delayMs = Math.min(baseMs * 2 ** (failCount - 1), BACKOFF_MAX_MS);
  return { failCount, nextRetryAt: now + delayMs };
}
function scheduleWorker(ms) {
  return chrome.alarms.create(WORKER_ALARM, { when: Date.now() + ms });
}

// --- Run engine ------------------------------------------------------------

/** Reads one source and folds the outcome into `agg` + `state.sourceBackoff`.
 *  Returns the outcome status string. */
async function processOneProfile(apiBaseUrl, apiToken, item, state, agg) {
  let outcome;
  try {
    outcome = await fetchIgItems(item.username, item.seeds);
  } catch (err) {
    outcome = { status: 'blocked', reason: String(err?.message ?? err) };
  }

  if (outcome.status === 'ok') {
    try {
      const { newItemCount } = await pushItems(apiBaseUrl, apiToken, item.sourceId, outcome.items, outcome.hasActiveStory);
      agg.newTotal += newItemCount || 0;
    } catch {
      /* push failed (network): still counts as read */
    }
    agg.ok += 1;
    delete state.sourceBackoff[item.sourceId];
    return 'ok';
  }
  if (outcome.status === 'no_seed') {
    agg.noSeed += 1;
    return 'no_seed';
  }
  if (outcome.status === 'empty') {
    agg.empty += 1;
    state.sourceBackoff[item.sourceId] = nextBackoff(state.sourceBackoff[item.sourceId], Date.now(), EMPTY_BACKOFF_BASE_MS);
    return 'empty';
  }
  agg.blocked += 1;
  state.sourceBackoff[item.sourceId] = nextBackoff(state.sourceBackoff[item.sourceId], Date.now(), BLOCKED_BACKOFF_BASE_MS);
  return 'blocked';
}

async function finalizeRun(apiBaseUrl, apiToken, folderId, folderName, agg, state, aborted) {
  if (agg.ok + agg.empty + agg.blocked > 0) {
    await reportReadLog(apiBaseUrl, apiToken, folderId, folderName, agg);
  }
  if (!aborted) {
    state.folderLastRun[folderId] = Date.now();
    if (ENABLE_DM_INBOX && state.globalCooldownUntil <= Date.now() && Date.now() - state.dmLastRun > DM_MIN_INTERVAL_MS) {
      try {
        const conversations = await fetchDmInbox();
        await pushDmInbox(apiBaseUrl, apiToken, conversations);
        state.dmLastRun = Date.now();
      } catch {
        /* DMs best-effort */
      }
    }
  }
  state.folderRuns[folderId] = {
    at: new Date().toISOString(),
    folderName,
    ok: agg.ok,
    newTotal: agg.newTotal,
    empty: agg.empty,
    blocked: agg.blocked,
    noSeed: agg.noSeed,
    completed: !aborted,
  };
  await persistState(state);
  await chrome.storage.local.set({
    workQueue: null,
    lastRun: { at: new Date().toISOString(), folderName, error: aborted ? 'Instagram limitou a sessão — pausando' : null },
  });
}

function newAgg() {
  return { ok: 0, empty: 0, blocked: 0, noSeed: 0, newTotal: 0 };
}

/** Builds the queue for a folder and kicks the worker. If `processFirst`, reads
 *  the first profile inline (instant feedback for a manual click). */
async function enqueueFolderRun(apiBaseUrl, apiToken, folder, state, processFirst) {
  await cleanupStrayTab();
  const now = Date.now();
  const seedsMap = await fetchSeeds(apiBaseUrl, apiToken);
  const items = folder.sources
    .filter((s) => !(state.sourceBackoff[s.sourceId] && state.sourceBackoff[s.sourceId].nextRetryAt > now))
    .map((s) => ({ sourceId: s.sourceId, username: s.username, seeds: seedsMap[s.sourceId] || [] }));

  if (items.length === 0) {
    state.folderLastRun[folder.folderId] = now;
    await persistState(state);
    return { started: false, agg: newAgg() };
  }

  const agg = newAgg();
  let startIndex = 0;

  if (processFirst) {
    const r = await processOneProfile(apiBaseUrl, apiToken, items[0], state, agg);
    startIndex = 1;
    if (r === 'blocked' && agg.blocked >= BLOCK_THRESHOLD) {
      state.globalCooldownUntil = Date.now() + GLOBAL_COOLDOWN_MS;
      await finalizeRun(apiBaseUrl, apiToken, folder.folderId, folder.name, agg, state, true);
      return { started: false, agg };
    }
  }

  if (startIndex >= items.length) {
    await finalizeRun(apiBaseUrl, apiToken, folder.folderId, folder.name, agg, state, false);
    return { started: false, agg };
  }

  const workQueue = { folderId: folder.folderId, folderName: folder.name, items, index: startIndex, agg, startedAt: now };
  await chrome.storage.local.set({ workQueue });
  await persistState(state);
  await scheduleWorker(randInt(MIN_GAP_MS, MAX_GAP_MS));
  return { started: true, agg };
}

/** Processes exactly one queued profile, then schedules the next or finalizes. */
async function runWorkerStep() {
  const { apiBaseUrl, apiToken } = await getConfig();
  if (!apiBaseUrl || !apiToken) return;
  await cleanupStrayTab();

  const workQueue = await getWorkQueue();
  if (!workQueue) return;
  const state = await getState();

  if (Date.now() < state.globalCooldownUntil) {
    await finalizeRun(apiBaseUrl, apiToken, workQueue.folderId, workQueue.folderName, workQueue.agg, state, true);
    return;
  }

  const item = workQueue.items[workQueue.index];
  if (!item) {
    await finalizeRun(apiBaseUrl, apiToken, workQueue.folderId, workQueue.folderName, workQueue.agg, state, false);
    return;
  }

  const r = await processOneProfile(apiBaseUrl, apiToken, item, state, workQueue.agg);
  if (r === 'blocked' && workQueue.agg.blocked >= BLOCK_THRESHOLD) {
    state.globalCooldownUntil = Date.now() + GLOBAL_COOLDOWN_MS;
    await finalizeRun(apiBaseUrl, apiToken, workQueue.folderId, workQueue.folderName, workQueue.agg, state, true);
    return;
  }

  workQueue.index += 1;
  if (workQueue.index < workQueue.items.length) {
    await chrome.storage.local.set({ workQueue });
    await persistState(state);
    await scheduleWorker(randInt(MIN_GAP_MS, MAX_GAP_MS));
  } else {
    await finalizeRun(apiBaseUrl, apiToken, workQueue.folderId, workQueue.folderName, workQueue.agg, state, false);
  }
}

/** Heartbeat: if idle, pick the most-overdue due folder and enqueue it. */
async function runScheduleTick() {
  const { apiBaseUrl, apiToken } = await getConfig();
  if (!apiBaseUrl || !apiToken) return;

  const workQueue = await getWorkQueue();
  if (workQueue) {
    if (Date.now() - (workQueue.startedAt || 0) > MAX_RUN_MS) {
      await cleanupStrayTab();
      await chrome.storage.local.set({ workQueue: null });
    } else {
      return; // run in progress
    }
  }

  const state = await getState();
  if (Date.now() < state.globalCooldownUntil) return;

  let folders;
  try {
    folders = await fetchIgFolders(apiBaseUrl, apiToken);
  } catch {
    return;
  }
  const schedule = await loadSchedule(apiBaseUrl, apiToken, folders);
  const now = Date.now();

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

  const claimed = await claimFolderRunOnServer(apiBaseUrl, apiToken, pick.folderId);
  if (claimed) await enqueueFolderRun(apiBaseUrl, apiToken, pick, state, false);
}

/** Manual "Sincronizar": reads the first profile inline (instant proof), then
 *  queues the rest. */
async function syncFolderNow(folderId) {
  const { apiBaseUrl, apiToken } = await getConfig();
  if (!apiBaseUrl || !apiToken) return { ok: false, error: 'not configured' };

  if (await getWorkQueue()) return { ok: false, error: 'já há uma sincronização em andamento' };

  const state = await getState();
  state.globalCooldownUntil = 0;

  let folders;
  try {
    folders = await fetchIgFolders(apiBaseUrl, apiToken);
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) };
  }
  const folder = folders.find((f) => f.folderId === folderId);
  if (!folder) return { ok: false, error: 'folder not found' };

  const claimed = await claimFolderRunOnServer(apiBaseUrl, apiToken, folderId);
  if (!claimed) return { ok: false, error: 'já sincronizando em outro dispositivo — tenta em alguns minutos' };

  const { started, agg } = await enqueueFolderRun(apiBaseUrl, apiToken, folder, state, true);
  return { ok: true, started, first: { ok: agg.ok, newTotal: agg.newTotal, empty: agg.empty, blocked: agg.blocked, noSeed: agg.noSeed } };
}

async function getPlan() {
  const { apiBaseUrl, apiToken } = await getConfig();
  if (!apiBaseUrl || !apiToken) return { configured: false, folders: [] };

  const state = await getState();
  const workQueue = await getWorkQueue();
  const folders = await fetchIgFolders(apiBaseUrl, apiToken);
  const schedule = await loadSchedule(apiBaseUrl, apiToken, folders);

  return {
    configured: true,
    globalCooldownUntil: state.globalCooldownUntil,
    activeFolderId: workQueue?.folderId || null,
    activeProgress: workQueue ? { index: workQueue.index, total: workQueue.items.length } : null,
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
  if (await getWorkQueue()) await scheduleWorker(randInt(15000, 45000)); // resume after reload/restart
}

chrome.runtime.onInstalled.addListener(scheduleAlarm);
chrome.runtime.onStartup.addListener(scheduleAlarm);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SCHEDULE_TICK_ALARM) runScheduleTick();
  else if (alarm.name === WORKER_ALARM) runWorkerStep();
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

chrome.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'sync-folder' && message.folderId) {
    syncFolderNow(message.folderId).then((r) => sendResponse(r));
    return true;
  }
  return undefined;
});
