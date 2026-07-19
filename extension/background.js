const ALARM_NAME = 'ig-sync';
const DEFAULT_SYNC_INTERVAL_MINUTES = 25;
const TAB_LOAD_TIMEOUT_MS = 15000;
const GRID_POLL_TIMEOUT_MS = 8000;
const INBOX_POLL_TIMEOUT_MS = 8000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
 * Calling Instagram's own web_profile_info endpoint ourselves — even from
 * this exact same-origin tab, with the real session — still got 429'd, while
 * the page's own normal render (doing the equivalent call internally) worked
 * every time in the same browser. So instead of guessing at whatever makes
 * that internal call "trusted", this reads the posts straight out of the
 * already-rendered grid (post links + each thumbnail's alt text) once the
 * page has loaded — no extra network request of our own at all.
 */
function scrapeProfileGridInPage(username, pollTimeoutMs) {
  return (async () => {
    try {
      function collectPosts() {
        const seen = new Set();
        const posts = [];
        // Post links can render as either "/p/{shortcode}/" or, inside a
        // profile's own grid, "/{username}/p/{shortcode}/" — match "/p/" or
        // "/reel/" anywhere in the path instead of anchoring at the start.
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

      // Canvas-presence heuristics (bare "any canvas", then "canvas with a
      // small negative offset") both false-positived way too often in
      // practice (~80% of profiles flagged, clearly wrong) — some other,
      // unrelated canvas apparently matches those shapes too. The signal we
      // actually confirmed live on two real profiles is structural instead:
      // with no active story the avatar <img> sits directly inside a real
      // link (<a href="/username/">); with an active story it's wrapped in a
      // <span> instead (with a ring <canvas> alongside it, but the canvas
      // itself isn't what's checked here anymore) -- no <a> parent is the signal.
      function hasActiveStoryRing() {
        const header = document.querySelector('header') || document.querySelector('main');
        const avatarImg = header?.querySelector('img');
        if (!avatarImg) return false;
        return avatarImg.parentElement?.tagName !== 'A';
      }

      // The grid renders client-side a moment after navigation finishes; poll briefly.
      const deadline = Date.now() + pollTimeoutMs;
      let posts = collectPosts();
      while (posts.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        posts = collectPosts();
      }
      const hasActiveStory = hasActiveStoryRing();
      if (posts.length === 0) {
        return {
          error: 'no posts found in the rendered page (private/empty profile, or the grid did not load in time)',
          hasActiveStory,
        };
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
 * Runs INSIDE instagram.com/direct/inbox/. There's no real per-conversation
 * link in this list (client-side-routed, no <a href>), so this only mirrors
 * the same sender + preview snippet already visible — never opens a thread
 * (which would very likely mark it "seen" for the sender).
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
          // Walk up from the name to the nearest ancestor that also contains
          // the row's avatar image -- a reasonable proxy for "the whole row".
          let row = nameSpan;
          while (row && row.parentElement && !row.querySelector('img')) row = row.parentElement;
          if (!row) return;
          const avatarUrl = row.querySelector('img')?.src;
          const previewText = (row.textContent || '').replace(senderName, '').trim();
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
  const { apiBaseUrl, apiToken, syncIntervalMinutes } = await chrome.storage.local.get([
    'apiBaseUrl',
    'apiToken',
    'syncIntervalMinutes',
  ]);
  return {
    apiBaseUrl: apiBaseUrl || '',
    apiToken: apiToken || '',
    syncIntervalMinutes: syncIntervalMinutes || DEFAULT_SYNC_INTERVAL_MINUTES,
  };
}

async function fetchDueSources(apiBaseUrl, apiToken) {
  const res = await fetch(`${apiBaseUrl}/api/extension/instagram/due`, {
    headers: { 'X-Extension-Token': apiToken },
  });
  if (!res.ok) throw new Error(`GET /due failed: ${res.status}`);
  const { sources } = await res.json();
  return sources;
}

async function fetchInstagramProfileItems(username) {
  const tab = await chrome.tabs.create({ url: `https://www.instagram.com/${encodeURIComponent(username)}/`, active: false });
  try {
    await waitForTabComplete(tab.id);
    const [{ result } = {}] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scrapeProfileGridInPage,
      args: [username, GRID_POLL_TIMEOUT_MS],
    });
    if (!result) throw new Error('no result from page script');
    if (result.error) throw new Error(result.error);
    return { items: result.items, hasActiveStory: result.hasActiveStory };
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

async function runSyncCycle() {
  const { apiBaseUrl, apiToken } = await getConfig();
  if (!apiBaseUrl || !apiToken) {
    await chrome.storage.local.set({ lastRun: { at: new Date().toISOString(), error: 'not configured', results: [] } });
    return;
  }

  const results = [];
  try {
    const due = await fetchDueSources(apiBaseUrl, apiToken);
    for (const { sourceId, username } of due) {
      try {
        const { items, hasActiveStory } = await fetchInstagramProfileItems(username);
        const { newItemCount } = await pushItems(apiBaseUrl, apiToken, sourceId, items, hasActiveStory);
        results.push({ username, status: 'ok', newItemCount, hasActiveStory });
      } catch (err) {
        results.push({ username, status: 'error', error: String(err?.message ?? err) });
      }
      // Small randomized gap between profiles so this never looks like a burst.
      await delay(2000 + Math.random() * 3000);
    }

    try {
      const conversations = await fetchDmInbox();
      await pushDmInbox(apiBaseUrl, apiToken, conversations);
      results.push({ username: '(mensagens)', status: 'ok', newItemCount: conversations.length });
    } catch (err) {
      results.push({ username: '(mensagens)', status: 'error', error: String(err?.message ?? err) });
    }
  } catch (err) {
    await chrome.storage.local.set({
      lastRun: { at: new Date().toISOString(), error: String(err?.message ?? err), results },
    });
    return;
  }

  await chrome.storage.local.set({ lastRun: { at: new Date().toISOString(), error: null, results } });
}

async function scheduleAlarm() {
  const { syncIntervalMinutes } = await getConfig();
  await chrome.alarms.create(ALARM_NAME, { periodInMinutes: syncIntervalMinutes, delayInMinutes: 1 });
}

chrome.runtime.onInstalled.addListener(() => {
  scheduleAlarm();
});

chrome.runtime.onStartup.addListener(() => {
  scheduleAlarm();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) runSyncCycle();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'sync-now') {
    runSyncCycle().then(() => sendResponse({ ok: true }));
    return true; // keep the message channel open for the async response
  }
  if (message?.type === 'reschedule') {
    scheduleAlarm().then(() => sendResponse({ ok: true }));
    return true;
  }
  return undefined;
});

// Lets the RSS Reader web page itself (origin declared in
// externally_connectable above) trigger a sync without opening the popup.
chrome.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'sync-now') {
    runSyncCycle().then(() => sendResponse({ ok: true }));
    return true;
  }
  return undefined;
});
