// ---------------------------------------------------------------------------
// Instagram bridge — MANUAL ONLY.
//
// There is NO scheduling, no alarms, no periodic sync. The extension reads
// Instagram only when the app explicitly asks (a per-profile or per-folder
// "Sincronizar" button in the sidebar messages us). This is deliberate: the
// account was getting rate-limited by frequent automatic reads across many
// profiles, so we only ever read what the user asks for, when they ask.
//
// READING: Instagram blocks the profile GRID ("Ocorreu um erro"), but a single
// POST page still loads and shows a "Mais posts de {user}" grid of that account's
// recent posts, plus the author's story ring. So we open ONE recent known post
// (a "seed" shortcode the server gives us) and read new posts + story from there
// — never the blocked profile grid. A brand-new profile with no known post yet
// is bootstrapped ONCE from its profile feed; every read after that uses a post
// page. Fast: one tab, bounded poll, closed right after. A folder run reads its
// DIRECT profiles in sequence with a short gap between them — target <~45s each.
//
// The VPS is a datacenter IP that Instagram blocks regardless of auth, so the
// server can't fetch this itself — it just stores what we push (see
// backend/src/modules/api/routes/extension.ts).
// ---------------------------------------------------------------------------

const TAB_LOAD_TIMEOUT_MS = 15000;
const GRID_POLL_TIMEOUT_MS = 10000;
const RELOAD_RETRY_POLL_TIMEOUT_MS = 15000;

// Short randomized gap between profiles in a folder run so a run isn't a hard
// burst, while still finishing quickly (manual, bounded to a leaf folder).
const MIN_GAP_MS = 2000;
const MAX_GAP_MS = 5000;

// How many saved posts we'll open before giving up on a source. A healthy source
// resolves on the 1st try (remembered good seed); the budget only gets spent by a
// source whose newest saved posts are collab/foreign ones we must skip past.
const MAX_SEED_ATTEMPTS = 8;

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
      // Shared, robust "does this account have an active story?" detector. Defined
      // inline because injected page scripts can't reference outer helpers.
      function makeStoryRingDetector(name) {
        const uname = String(name || '').toLowerCase();
        return function hasActiveStoryRing() {
          const avatars = [];
          const add = (el) => {
            if (el && !avatars.includes(el)) avatars.push(el);
          };
          add(document.querySelector(`a[href="/${uname}/"] img`));
          for (const img of document.querySelectorAll('img[alt]')) {
            const alt = (img.getAttribute('alt') || '').toLowerCase();
            if (alt.includes(uname) && /perfil|profile/.test(alt)) add(img);
          }
          add(document.querySelector('header img'));
          add(document.querySelector('section header img'));
          add(document.querySelector('main header img'));
          // Primary signal: the gradient ring is a <canvas> around the avatar.
          for (const avatar of avatars) {
            let node = avatar;
            for (let i = 0; i < 5 && node; i++) {
              if (node.querySelector && node.querySelector('canvas')) return true;
              node = node.parentElement;
            }
          }
          // Secondary: the story button is aria-labeled with the account's name
          // (e.g. "história de disturbia"), excluding highlights ("destaques").
          for (const el of document.querySelectorAll('[aria-label]')) {
            const label = (el.getAttribute('aria-label') || '').toLowerCase();
            if (/hist[óo]ria|story/.test(label) && label.includes(uname) && !/destaque|highlight/.test(label)) return true;
          }
          return false;
        };
      }

      function bestImageUrl(img) {
        if (!img) return undefined;
        const cur = img.currentSrc || img.getAttribute('src') || '';
        if (/^https?:/i.test(cur)) return cur;
        const ss = img.getAttribute('srcset') || '';
        const first = ss.split(',')[0]?.trim().split(/\s+/)[0];
        if (first && /^https?:/i.test(first)) return first;
        return undefined;
      }

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
          posts.push({ shortcode, alt: img?.getAttribute('alt') || '', imageUrl: bestImageUrl(img) });
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

      const hasActiveStoryRing = makeStoryRingDetector(username);

      const deadline = Date.now() + pollTimeoutMs;
      let posts = collectPosts();
      let hasActiveStory = hasActiveStoryRing();
      while (posts.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        posts = collectPosts();
        if (!hasActiveStory) hasActiveStory = hasActiveStoryRing();
      }
      // The header (with the story ring) loads even when the grid is blocked, so
      // give the ring a couple more chances before concluding there's no story.
      for (let k = 0; k < 2 && !hasActiveStory; k++) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        hasActiveStory = hasActiveStoryRing();
      }

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
 * Runs on a POST page (instagram.com/p/{shortcode}/). Reads the "Mais posts de
 * {user}" grid (which loads even when the profile grid is blocked) and the
 * author's story ring. Returns:
 *   { items, hasActiveStory } | { unavailable } | { blocked, reason, hasActiveStory }
 *   | { empty, hasActiveStory } | { error }
 */
function scrapePostPageInPage(username, pollTimeoutMs) {
  return (async () => {
    const user = String(username || '').toLowerCase();
    try {
      // Shared, robust "does this account have an active story?" detector. Defined
      // inline because injected page scripts can't reference outer helpers.
      function makeStoryRingDetector(name) {
        const uname = String(name || '').toLowerCase();
        return function hasActiveStoryRing() {
          const avatars = [];
          const add = (el) => {
            if (el && !avatars.includes(el)) avatars.push(el);
          };
          add(document.querySelector(`a[href="/${uname}/"] img`));
          for (const img of document.querySelectorAll('img[alt]')) {
            const alt = (img.getAttribute('alt') || '').toLowerCase();
            if (alt.includes(uname) && /perfil|profile/.test(alt)) add(img);
          }
          add(document.querySelector('header img'));
          add(document.querySelector('section header img'));
          add(document.querySelector('main header img'));
          // Primary signal: the gradient ring is a <canvas> around the avatar.
          for (const avatar of avatars) {
            let node = avatar;
            for (let i = 0; i < 5 && node; i++) {
              if (node.querySelector && node.querySelector('canvas')) return true;
              node = node.parentElement;
            }
          }
          // Secondary: the story button is aria-labeled with the account's name
          // (e.g. "história de disturbia"), excluding highlights ("destaques").
          for (const el of document.querySelectorAll('[aria-label]')) {
            const label = (el.getAttribute('aria-label') || '').toLowerCase();
            if (/hist[óo]ria|story/.test(label) && label.includes(uname) && !/destaque|highlight/.test(label)) return true;
          }
          return false;
        };
      }

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
      // Instagram labels the grid under a post with "Mais posts de {owner}". That
      // label is the ONLY reliable statement of WHOSE posts the grid holds, and it
      // is what protects us from collab posts: a post co-authored with another
      // account shows THAT account's grid. Ingesting it would not just add wrong
      // items — since seeds come from the newest stored post, the next sync would
      // open the other account's post and drag the whole feed over to them.
      const GRID_LABEL_RE =
        /(?:mais publica(?:ç|c)(?:ões|oes) de|mais posts de|more posts from|m(?:á|a)s publicaciones de)/i;

      /** "/disturbia/" -> "disturbia". Only a bare profile path; "/p/ABC/" won't match. */
      function profileHrefUser(a) {
        const m = (a.getAttribute('href') || '').match(/^\/([A-Za-z0-9_.]+)\/?$/);
        return m ? m[1].toLowerCase() : null;
      }

      function findGridLabel() {
        const matches = [];
        for (const el of document.querySelectorAll('span, h1, h2, h3, div, a, section, header')) {
          const txt = (el.textContent || '').trim();
          if (!txt || txt.length > 200) continue;
          if (GRID_LABEL_RE.test(txt)) matches.push(el);
        }
        if (!matches.length) return null;
        // Use the INNERMOST match — the label itself. Taking an outer wrapper made
        // us read its whole subtree, gluing the grid's icon labels onto the name
        // ("disturbia" + "clipe"/"carrossel" -> "disturbiaclipecarrosselclipe"),
        // which then failed the owner check against the real account.
        const el = matches.find((m) => !matches.some((o) => o !== m && m.contains(o))) || matches[matches.length - 1];

        // Read the account from the profile LINK's href. The href is exact — it
        // cannot pick up neighbouring text the way textContent does. Walk up a few
        // levels because the name usually sits in a sibling <a> of the label text.
        let node = el;
        for (let i = 0; i < 4 && node; i++) {
          if (node.matches && node.matches('a')) {
            const self = profileHrefUser(node);
            if (self) return { el, owner: self };
          }
          if (node.querySelectorAll) {
            for (const a of node.querySelectorAll('a')) {
              const u = profileHrefUser(a);
              if (u) return { el, owner: u };
            }
          }
          node = node.parentElement;
        }

        // Fallback: parse the label's own (clean) text, then prove the account
        // really exists on the page before trusting it.
        const m = (el.textContent || '').trim().match(new RegExp(GRID_LABEL_RE.source + '\\s*@?([a-z0-9_.]+)', 'i'));
        if (m) {
          const owner = m[1].toLowerCase();
          if (document.querySelector(`a[href="/${owner}/"]`)) return { el, owner };
        }
        return null;
      }

      // The "more posts" grid sits BELOW the main post (off-screen on load), so
      // its thumbnails are lazy: <img>.src is often a blank/1x1 placeholder until
      // the row is scrolled near the viewport. This is why post-page reads landed
      // image-less while profile reads (grid at the top) didn't. Prefer
      // currentSrc, reject data: placeholders, and fall back to the first srcset URL.
      function bestImageUrl(img) {
        if (!img) return undefined;
        const cur = img.currentSrc || img.getAttribute('src') || '';
        if (/^https?:/i.test(cur)) return cur;
        const ss = img.getAttribute('srcset') || '';
        const first = ss.split(',')[0]?.trim().split(/\s+/)[0];
        if (first && /^https?:/i.test(first)) return first;
        return undefined;
      }

      // Pull the grid rows into view so their lazy thumbnails start loading. The
      // tab is opened in the background (no user scroll to trigger it), so we do
      // it ourselves, then scroll back to the top.
      function nudgeLazyImages(labelEl) {
        try { labelEl.scrollIntoView({ block: 'start' }); } catch {}
        for (const a of document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]')) {
          if (!(labelEl.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
          const im = a.querySelector('img');
          if (im) { try { im.scrollIntoView({ block: 'center' }); } catch {} }
        }
        try { window.scrollTo(0, 0); } catch {}
      }

      /** Collects ONLY the post links that come after the "more posts" label —
       *  i.e. the grid itself, never the main post or unrelated links. */
      function collect(labelEl) {
        const seen = new Set();
        const out = [];
        for (const a of document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]')) {
          if (!(labelEl.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
          const href = a.getAttribute('href') || '';
          const m = href.match(/\/(?:([^/]+)\/)?(p|reel)\/([A-Za-z0-9_-]+)/);
          if (!m) continue;
          const owner = m[1] && m[1] !== 'p' && m[1] !== 'reel' ? m[1].toLowerCase() : null;
          if (owner && owner !== user) continue; // URL names another account -> drop
          const shortcode = m[3];
          if (seen.has(shortcode)) continue;
          seen.add(shortcode);
          const img = a.querySelector('img');
          out.push({ shortcode, alt: img?.getAttribute('alt') || '', imageUrl: bestImageUrl(img) });
        }
        return out; // DOM order == newest first in the "more posts" grid
      }
      const hasActiveStoryRing = makeStoryRingDetector(username);

      const deadline = Date.now() + pollTimeoutMs;
      // 1) Wait for the "Mais posts de X" label. We refuse to read a grid whose
      //    owner we cannot prove.
      let label = findGridLabel();
      while (!label && Date.now() < deadline) {
        if (detectUnavailable()) return { unavailable: true };
        await new Promise((r) => setTimeout(r, 500));
        label = findGridLabel();
      }
      // Story ring can render a beat after the grid; retry briefly before deciding.
      let hasActiveStory = hasActiveStoryRing();
      for (let k = 0; k < 2 && !hasActiveStory; k++) {
        await new Promise((r) => setTimeout(r, 400));
        hasActiveStory = hasActiveStoryRing();
      }
      if (!label) {
        if (detectUnavailable()) return { unavailable: true };
        const reason = detectBlockReason();
        if (reason) return { blocked: true, reason, hasActiveStory };
        return { unverified: true, hasActiveStory }; // ownership unproven -> ingest nothing
      }
      // 2) HARD GATE: the grid must belong to THIS source, or we take nothing.
      //    This is what stops a collab post from importing the co-author's feed.
      if (label.owner !== user) {
        return { wrongOwner: true, gridOwner: label.owner, hasActiveStory };
      }
      // 3) Ownership proven — only now read the grid.
      let posts = collect(label.el);
      while (posts.length === 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 500));
        posts = collect(label.el);
      }
      // Wait for the lazy thumbnails to resolve before returning, nudging them
      // into view each pass — otherwise items get ingested image-less (exactly
      // the bug this fixes). Best-effort: if some never load before the deadline,
      // we still return what we have rather than blocking the whole run.
      if (posts.length > 0) {
        let withImg = posts.filter((p) => p.imageUrl).length;
        while (withImg < posts.length && Date.now() < deadline) {
          nudgeLazyImages(label.el);
          if (!hasActiveStory) hasActiveStory = hasActiveStoryRing();
          await new Promise((r) => setTimeout(r, 500));
          posts = collect(label.el);
          withImg = posts.filter((p) => p.imageUrl).length;
        }
      }
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

// Built-in connection so the extension works WITHOUT configuring anything in the
// Options page. Whatever is saved in storage (via Options) still takes priority.
// The token is intentionally EMPTY here (this file is in a public repo) and is
// filled in locally on the machine that runs the extension.
const DEFAULT_API_BASE_URL = 'http://179.197.226.119:3001';
const DEFAULT_API_TOKEN = '';

async function getConfig() {
  const { apiBaseUrl, apiToken } = await chrome.storage.local.get(['apiBaseUrl', 'apiToken']);
  return {
    apiBaseUrl: apiBaseUrl || DEFAULT_API_BASE_URL,
    apiToken: apiToken || DEFAULT_API_TOKEN,
  };
}

// Remembered "good seed" per source: a post that PROVED it shows this account's
// own grid. The "Mais posts" grid of an OLD post still lists the account's RECENT
// posts, so a seed that worked once keeps working — which means we stop paying
// the cost (and the drift risk) of guessing with collab posts every sync.
async function getGoodSeeds() {
  const { goodSeeds } = await chrome.storage.local.get('goodSeeds');
  return goodSeeds || {};
}
async function setGoodSeed(sourceId, shortcode) {
  const goodSeeds = await getGoodSeeds();
  if (goodSeeds[sourceId] === shortcode) return;
  goodSeeds[sourceId] = shortcode;
  await chrome.storage.local.set({ goodSeeds });
}
async function clearGoodSeed(sourceId) {
  const goodSeeds = await getGoodSeeds();
  if (!(sourceId in goodSeeds)) return;
  delete goodSeeds[sourceId];
  await chrome.storage.local.set({ goodSeeds });
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

/** Map of sourceId -> recent known post shortcodes ("seeds" we open as post pages). */
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

async function runProfileScrape(tabId, username, pollMs) {
  const exec = chrome.scripting
    .executeScript({ target: { tabId }, func: scrapeProfileGridInPage, args: [username, pollMs] })
    .then((r) => (r && r[0] ? r[0].result : undefined))
    .catch((err) => ({ error: String(err?.message ?? err) }));
  const timeout = new Promise((resolve) => setTimeout(() => resolve({ error: 'scrape_timeout' }), pollMs + 8000));
  return (await Promise.race([exec, timeout])) || { error: 'no result from page script' };
}

/** BOOTSTRAP ONLY: opens the profile page (blocked-prone grid), reads it + story.
 *  Used just the first time for a profile we have no known post to seed from. */
async function fetchInstagramProfileItems(username) {
  console.log(`[IG] bootstrap: abrindo perfil @${username}`);
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

async function runPostScrape(tabId, username, pollMs) {
  const exec = chrome.scripting
    .executeScript({ target: { tabId }, func: scrapePostPageInPage, args: [username, pollMs] })
    .then((r) => (r && r[0] ? r[0].result : undefined))
    .catch((err) => ({ error: String(err?.message ?? err) }));
  const timeout = new Promise((resolve) => setTimeout(() => resolve({ error: 'scrape_timeout' }), pollMs + 8000));
  return (await Promise.race([exec, timeout])) || { error: 'no result from page script' };
}

/** Opens one known post page, reads its "Mais posts" grid + story. Reloads once
 *  ONLY on `empty` (slow grid) — never on a block or an unavailable post. */
async function fetchViaPostPage(username, shortcode) {
  console.log(`[IG] abrindo post ${shortcode} de @${username}`);
  const tab = await openTrackedTab(`https://www.instagram.com/p/${shortcode}/`);
  try {
    await waitForTabComplete(tab.id);
    let result = await runPostScrape(tab.id, username, GRID_POLL_TIMEOUT_MS);
    // Retry once when the grid (or its owner label) simply hadn't rendered yet.
    if (!result.items && (result.empty || result.unverified) && !result.blocked && !result.unavailable && !result.wrongOwner) {
      await delay(1500 + Math.random() * 1500);
      await chrome.tabs.reload(tab.id);
      await waitForTabComplete(tab.id);
      result = await runPostScrape(tab.id, username, RELOAD_RETRY_POLL_TIMEOUT_MS);
    }
    if (result.items) return { status: 'ok', items: result.items, hasActiveStory: result.hasActiveStory };
    if (result.unavailable) return { status: 'unavailable' };
    if (result.wrongOwner) {
      console.warn(`[IG] ${shortcode}: a grade é de @${result.gridOwner}, não de @${username} (post de collab) — ignorado`);
      return { status: 'wrong_owner', gridOwner: result.gridOwner };
    }
    if (result.unverified) {
      console.warn(`[IG] ${shortcode}: não deu pra provar de quem é a grade — nada ingerido`);
      return { status: 'unverified', hasActiveStory: result.hasActiveStory };
    }
    if (result.blocked) return { status: 'blocked', reason: result.reason, hasActiveStory: result.hasActiveStory };
    if (result.empty) return { status: 'empty', hasActiveStory: result.hasActiveStory };
    return { status: 'blocked', reason: result.error || 'unknown' };
  } finally {
    await closeTrackedTab(tab.id);
    console.log(`[IG] fechou post ${shortcode}`);
  }
}

/**
 * Reads a profile via its recent post pages, trying each seed shortcode in order.
 * A profile with NO seed yet (brand-new, never read) is bootstrapped ONCE from
 * its profile feed; from then on it has posts, so the next read uses a post page.
 */
async function fetchIgItems(sourceId, username, seeds) {
  const good = (await getGoodSeeds())[sourceId];
  const stored = seeds || [];
  // Remembered good seed first, then the newest saved posts.
  const codes = good ? [good, ...stored.filter((c) => c !== good)] : [...stored];
  if (codes.length === 0) return fetchInstagramProfileItems(username); // bootstrap

  let wrongOwner = null;
  let attempts = 0;
  // A post page's header shows the author's story ring even when its grid has no
  // NEW posts, so we still learn the story state here. Remember it so an "empty"
  // read can carry it to the server (turning a ring on OR off), the same way the
  // profile-feed path already does — this is what makes stories update reliably
  // through the post-page path too, not only when new posts happen to appear.
  let sawStorySignal = false;
  let observedStory = false;
  for (const shortcode of codes) {
    if (attempts >= MAX_SEED_ATTEMPTS) break;
    attempts += 1;
    const res = await fetchViaPostPage(username, shortcode);
    if (typeof res.hasActiveStory === 'boolean') {
      sawStorySignal = true;
      observedStory = observedStory || res.hasActiveStory;
    }
    if (res.status === 'ok') {
      await setGoodSeed(sourceId, shortcode); // proven to show OUR grid — reuse it
      return res;
    }
    if (res.status === 'blocked') return res;
    // A seed that is a collab post shows the CO-AUTHOR's grid. Never ingest it —
    // walk on to an older seed until we find one that is provably this account's.
    if (res.status === 'wrong_owner') wrongOwner = res.gridOwner;
    if (good && shortcode === good) await clearGoodSeed(sourceId); // stale, drop it
    // 'unavailable' | 'empty' | 'unverified' | 'wrong_owner' -> try the next seed
  }
  // undefined (not false) when no page ever loaded, so the caller can tell
  // "no story" apart from "couldn't check" and avoid wrongly clearing a ring.
  const hasActiveStory = sawStorySignal ? observedStory : undefined;
  if (wrongOwner) return { status: 'wrong_owner', gridOwner: wrongOwner, hasActiveStory };
  return { status: 'empty', hasActiveStory };
}

// Instagram encodes the post's creation time in its shortcode. Decode the
// base64 shortcode to the media id, then (id >> 23) ms + the IG epoch gives the
// real publish time — no extra request, exact to the second (validated against
// real posts). This is what lets the app show "há 30 min / 2 h / 3 dias" and
// sort by POST date instead of by when we happened to read it.
const IG_SHORTCODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const IG_EPOCH_MS = 1314220021721n;
function shortcodeToPublishedAtIso(shortcode) {
  try {
    if (!shortcode) return undefined;
    let id = 0n;
    for (const ch of shortcode) {
      const k = IG_SHORTCODE_ALPHABET.indexOf(ch);
      if (k < 0) return undefined; // not a shortcode we can decode
      id = id * 64n + BigInt(k);
    }
    const ms = Number((id >> 23n) + IG_EPOCH_MS);
    // Sanity gate: only trust plausible dates (2012-01-01 .. now+1d). If IG ever
    // changes the shortcode scheme this fails closed → server keeps read time.
    if (!Number.isFinite(ms) || ms < 1325376000000 || ms > Date.now() + 86400000) return undefined;
    return new Date(ms).toISOString();
  } catch {
    return undefined;
  }
}

async function pushItems(apiBaseUrl, apiToken, sourceId, items, hasActiveStory) {
  // Fill each item's real post date from its shortcode (guid) when we don't
  // already have one, so the server stores post-time, not read-time.
  const withDates = (items || []).map((it) =>
    it.publishedAt ? it : { ...it, publishedAt: shortcodeToPublishedAtIso(it.guid) },
  );
  const res = await fetch(`${apiBaseUrl}/api/extension/instagram/${sourceId}/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Extension-Token': apiToken },
    body: JSON.stringify({ items: withDates, hasActiveStory }),
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
  return { ok: 0, empty: 0, blocked: 0, wrongOwner: 0, newTotal: 0 };
}

/** Reads one profile and folds the outcome into `agg`. Returns the status. */
async function processProfile(apiBaseUrl, apiToken, item, agg) {
  let outcome;
  try {
    outcome = await fetchIgItems(item.sourceId, item.username, item.seeds);
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

  // Even with no new posts, a loaded post page still told us the story-ring
  // state, so push JUST that flag (no items) — this is what lets a story
  // starting or expiring show up through the post-page path, not only when new
  // posts happen to appear. Skip outcomes where the page didn't really load
  // (blocked/unavailable) or where the grid belonged to another account, since
  // the ring we'd read there isn't trustworthy.
  if (
    typeof outcome.hasActiveStory === 'boolean' &&
    outcome.status !== 'blocked' &&
    outcome.status !== 'unavailable' &&
    outcome.status !== 'wrong_owner'
  ) {
    try {
      await pushItems(apiBaseUrl, apiToken, item.sourceId, [], outcome.hasActiveStory);
    } catch {
      /* story flag best-effort */
    }
  }

  if (outcome.status === 'empty') {
    agg.empty += 1;
    return 'empty';
  }
  // Every saved seed for this source turned out to be a collab post showing
  // someone else's grid. Nothing was ingested (that is the point), but the
  // source is stuck until its contaminated items are cleared.
  if (outcome.status === 'wrong_owner') {
    agg.wrongOwner += 1;
    agg.wrongOwnerName = outcome.gridOwner;
    return 'wrong_owner';
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

  const seedsMap = await fetchSeeds(apiBaseUrl, apiToken);
  item.seeds = seedsMap[sourceId] || [];

  const agg = newAgg();
  const status = await processProfile(apiBaseUrl, apiToken, item, agg);
  // Surface this one loudly: it means the saved posts for this source belong to
  // another account, so syncing can't move forward until they're cleaned out.
  if (status === 'wrong_owner') {
    return {
      ok: false,
      error:
        `Os posts recentes salvos de @${item.username} são de OUTRA conta (@${agg.wrongOwnerName}) — provavelmente entraram por um post de collab. ` +
        `Nada foi importado, de propósito. Apague os itens errados dessa fonte para destravar.`,
    };
  }
  return { ok: true, status, newTotal: agg.newTotal, ...agg };
}

/**
 * Manual "Atualizar pelo feed do perfil" on a SINGLE profile. Opens the account's
 * own profile page and reads its grid directly. This surface is the one Instagram
 * rate-limits, so it is exposed ONLY per-profile (never on folders) — the user
 * chooses to spend it, one account at a time. No owner gate is needed: the profile
 * page only shows this account's own posts. The header (with the story ring) loads
 * even when the grid is blocked, so the story state is updated regardless.
 */
async function syncSourceFeedNow(sourceId) {
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

  let outcome;
  try {
    outcome = await fetchInstagramProfileItems(item.username);
  } catch (err) {
    outcome = { status: 'blocked', reason: String(err?.message ?? err) };
  }

  // Push whatever we got. Even on block/empty we still send the story flag, since
  // the profile header + its ring render even when the grid errors out.
  const items = outcome.status === 'ok' ? outcome.items : [];
  let newTotal = 0;
  if (typeof outcome.hasActiveStory === 'boolean' || items.length) {
    try {
      const r = await pushItems(apiBaseUrl, apiToken, item.sourceId, items, outcome.hasActiveStory);
      newTotal = r.newItemCount || 0;
    } catch {
      /* network: still counts as read */
    }
  }

  if (outcome.status === 'ok') return { ok: true, status: 'ok', newTotal, hadStory: outcome.hasActiveStory };
  if (outcome.status === 'empty') return { ok: true, status: 'empty', newTotal: 0, hadStory: outcome.hasActiveStory };
  return {
    ok: false,
    error: `O Instagram bloqueou o feed de @${item.username} ("Ocorreu um erro"). Tente de novo mais tarde, ou use o ⟳ (leitura pela página do post).`,
    hadStory: outcome.hasActiveStory,
  };
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

  const seedsMap = await fetchSeeds(apiBaseUrl, apiToken);
  const items = folder.sources.map((s) => ({ ...s, seeds: seedsMap[s.sourceId] || [] }));
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
  if (message?.type === 'sync-source-feed' && message.sourceId) {
    syncSourceFeedNow(message.sourceId).then((r) => sendResponse(r));
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
// externally_connectable / onMessageExternal only exists on Chrome. On Firefox
// `chrome.runtime.onMessageExternal` is undefined, and touching `.addListener`
// on it throws while the background loads — which stops the whole background
// from answering messages (the app then reports "extension not detected", even
// though the Firefox bridge relays correctly). Guard it so Firefox is happy;
// there, the app reaches us through bridge.js + onMessage above instead.
if (chrome.runtime.onMessageExternal) {
  chrome.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => handleMessage(message, sendResponse));
}
