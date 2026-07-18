const ALARM_NAME = 'ig-sync';
const DEFAULT_SYNC_INTERVAL_MINUTES = 25;
const IG_APP_ID = '936619743392459';
const IG_ASBD_ID = '359341';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function firstLine(text, maxLength = 120) {
  if (!text) return '(sem legenda)';
  const line = text.split('\n', 1)[0];
  return line.length > maxLength ? `${line.slice(0, maxLength)}…` : line;
}

/**
 * Hits the same undocumented endpoint RSSHub's own instagram/web-api route
 * uses (lib/routes/instagram/web-api/utils.ts), but from the user's real
 * browser/session/IP instead of a datacenter server — that's the whole point,
 * Instagram blocks the latter regardless of auth.
 */
async function fetchInstagramProfileItems(username) {
  const csrfCookie = await chrome.cookies.get({ url: 'https://www.instagram.com', name: 'csrftoken' });
  if (!csrfCookie) throw new Error('not logged into instagram.com in this browser');

  const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;
  const res = await fetch(url, {
    credentials: 'include',
    headers: {
      'x-ig-app-id': IG_APP_ID,
      'x-asbd-id': IG_ASBD_ID,
      'x-ig-www-claim': '0',
      'x-csrftoken': csrfCookie.value,
    },
  });
  if (!res.ok) throw new Error(`instagram fetch failed: ${res.status}`);

  const body = await res.json();
  const edges = body?.data?.user?.edge_owner_to_timeline_media?.edges ?? [];

  return edges.map(({ node }) => {
    const caption = node.edge_media_to_caption?.edges?.[0]?.node?.text ?? '';
    return {
      guid: node.id,
      link: `https://www.instagram.com/p/${node.shortcode}/`,
      title: firstLine(caption),
      summary: caption,
      imageUrl: node.display_url,
      author: node.owner?.username,
      publishedAt: node.taken_at_timestamp ? new Date(node.taken_at_timestamp * 1000).toISOString() : undefined,
    };
  });
}

async function pushItems(apiBaseUrl, apiToken, sourceId, items) {
  const res = await fetch(`${apiBaseUrl}/api/extension/instagram/${sourceId}/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Extension-Token': apiToken },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) throw new Error(`push items failed: ${res.status}`);
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
        const items = await fetchInstagramProfileItems(username);
        const { newItemCount } = await pushItems(apiBaseUrl, apiToken, sourceId, items);
        results.push({ username, status: 'ok', newItemCount });
      } catch (err) {
        results.push({ username, status: 'error', error: String(err?.message ?? err) });
      }
      // Small randomized gap between profiles so this never looks like a burst.
      await delay(2000 + Math.random() * 3000);
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
