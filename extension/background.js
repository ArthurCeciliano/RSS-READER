// ---------------------------------------------------------------------------
// Instagram bridge — MANUAL ONLY.
//
// There is NO scheduling, no alarms, no periodic sync. The extension reads
// Instagram only when the app explicitly asks (a per-profile or per-folder
// "Sincronizar" button in the sidebar messages us). This is deliberate: the
// account was getting rate-limited by frequent automatic reads across many
// profiles, so we only ever read what the user asks for, when they ask.
//
// READING: back to the profile feed itself — open instagram.com/{user}/, read
// the post grid AND detect an active story from the avatar ring. Fast: one tab,
// bounded poll, closed right after. A folder run reads its DIRECT profiles in
// sequence with a short gap (a few seconds) between them — target <~45s/profile.
//
// The VPS is a datacenter IP that Instagram blocks regardless of auth, so the
// server can't fetch this itself — it just stores what we push (see
// backend/src/modules/api/routes/extension.ts).
// ---------------------------------------------------------------------------

const TAB_LOAD_TIMEOUT_MS = 15000;
const GRID_POLL_TIMEOUT_MS = 10000;

// Short randomized gap between profiles in a folder run so a run isn't a hard
// burst, while still finishing quickly (manual, bounded to a leaf folder).
const MIN_GAP_MS = 2000;
const MAX_GAP_MS = 5000;

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

// --- Tab bookkeeping (so a killed step's orphan tab gets cleaned up next run) -

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
async function cleanupStrayTab() {
  const { openTabId } = await chrome.storage.local.get('openTabId');
  if (openTabId != null) {
    await chrome.tabs.remove(openTabId).catch(() => {});
    await chrome.storage.local.remove('openTabId');
  }
}

// --- Page script (runs INSIDE the profile page) -----------------------------

/**
 * Runs on a profile page (instagram.com/{username}/). Reads the post grid and
 * detects an active story from the avatar ring. Returns:
 *   { items, hasActiveStory } | { blocked, reason, hasActiveStory }
 *   | { empty, hasActiveStory } | { error }
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

// --- Config / progress ------------------------------------------------------

async function getConfig() {
  const { apiBaseUrl, apiToken } = await chrome.storage.local.get(['apiBaseUrl', 'apiToken']);
  return { apiBaseUrl: apiBaseUrl || '', apiToken: apiToken || '' };
}

// Lightweight progress for a folder run so the app can show "i/total".
async function setProgress(progress) {
  await chrome.storage.local.set({ igProgress: progress });
}
async function clearProgress() {
  await chrome.storage.local.remove('igProgress');
}
async function getProgress() {
  const { igProgress } = await chrome.storage.local.get('igProgress');
  return igProgress || null;
}

// --- API + reading ----------------------------------------------------------

/** Folders (nested) with their DIRECT instagram sources, resolved to usernames. */
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
  const exec = chrome.scripting
    .executeScript({ target: { tabId }, func: scrapeProfileGridInPage, args: [username, pollMs] })
    .then((r) => (r && r[0] ? r[0].result : undefined))
    .catch((err) => ({ error: String(err?.message ?? err) }));
  const timeout = new Promise((resolve) => setTimeout(() => resolve({ error: 'scrape_timeout' }), pollMs + 8000));
  return (await Promise.race([exec, timeout])) || { error: 'no result from page script' };
}

/** Opens the profile page, reads its grid + story, closes the tab. */
async function fetchInstagramProfileItems(username) {
  console.log(`[IG] abrindo perfil @${username}`);
  const tab = await openTrackedTab(`https://www.instagram.com/${username}/`);
  try {
    await waitForTabComplete(tab.id);
    const result = await runProfileScrape(tab.id, username, GRID_POLL_TIMEOUT_MS);
    if (result.items) return { status: 'ok', items: result.items, hasActiveStory: result.hasActiveStory };
    if (result.blocked) return { status: 'blocked', reason: result.reason, hasActiveStory: result.hasActiveStory };
    if (result.empty) return { status: 'empty', hasActiveStory: result.hasActiveStory };
    return { status: 'blocked', reason: result.error || 'unknown' };
  } finally {
    await closeTrackedTab(tab.id);
    console.log(`[IG] fechou perfil @${username}`);
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

// --- Run engine (manual) ----------------------------------------------------

function newAgg() {
  return { ok: 0, empty: 0, blocked: 0, newTotal: 0 };
}

/** Reads one profile and folds the outcome into `agg`. Returns the status. */
async function processProfile(apiBaseUrl, apiToken, item, agg) {
  let outcome;
  try {
    outcome = await fetchInstagramProfileItems(item.username);
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
    return 'ok';
  }
  if (outcome.status === 'empty') {
    agg.empty += 1;
    return 'empty';
  }
  agg.blocked += 1;
  return 'blocked';
}

/** Manual "Sincronizar" on a single profile. */
async function syncSourceNow(sourceId) {
  const { apiBaseUrl, apiToken } = await getConfig();
  if (!apiBaseUrl || !apiToken) return { ok: false, error: 'not configured' };
  await cleanupStrayTab();

  let folders;
  try {
    folders = await fetchIgFolders(apiBaseUrl, apiToken);
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) };
  }
  const item = folders.flatMap((f) => f.sources).find((s) => s.sourceId === sourceId);
  if (!item) return { ok: false, error: 'instagram source not found' };

  const agg = newAgg();
  const status = await processProfile(apiBaseUrl, apiToken, item, agg);
  return { ok: true, status, newTotal: agg.newTotal, ...agg };
}

/** Manual "Sincronizar" on a folder: reads its DIRECT profiles in sequence. */
async function syncFolderNow(folderId) {
  const { apiBaseUrl, apiToken } = await getConfig();
  if (!apiBaseUrl || !apiToken) return { ok: false, error: 'not configured' };
  await cleanupStrayTab();

  let folders;
  try {
    folders = await fetchIgFolders(apiBaseUrl, apiToken);
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) };
  }
  const folder = folders.find((f) => f.folderId === folderId);
  if (!folder) return { ok: false, error: 'folder not found' };

  const items = folder.sources;
  const agg = newAgg();
  try {
    for (let i = 0; i < items.length; i++) {
      await setProgress({ activeFolderId: folderId, index: i, total: items.length });
      await processProfile(apiBaseUrl, apiToken, items[i], agg);
      if (i < items.length - 1) await delay(randInt(MIN_GAP_MS, MAX_GAP_MS));
    }
  } finally {
    await clearProgress();
  }
  await reportReadLog(apiBaseUrl, apiToken, folderId, folder.name, agg);
  return { ok: true, total: items.length, ...agg };
}

// --- Messaging --------------------------------------------------------------

function handleMessage(message, sendResponse) {
  if (message?.type === 'sync-source' && message.sourceId) {
    syncSourceNow(message.sourceId).then((r) => sendResponse(r));
    return true;
  }
  if (message?.type === 'sync-folder' && message.folderId) {
    syncFolderNow(message.folderId).then((r) => sendResponse(r));
    return true;
  }
  if (message?.type === 'get-status') {
    Promise.all([getConfig(), getProgress()]).then(([cfg, progress]) =>
      sendResponse({ configured: Boolean(cfg.apiBaseUrl && cfg.apiToken), progress }),
    );
    return true;
  }
  return undefined;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => handleMessage(message, sendResponse));
chrome.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => handleMessage(message, sendResponse));
