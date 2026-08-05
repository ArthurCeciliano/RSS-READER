// Content script injected into the RSS Reader app page.
//
// On Chrome the frontend talks to this extension directly via
// externally_connectable. Firefox doesn't support that, so this bridge relays
// messages between the page (window.postMessage) and the extension background
// (chrome.runtime.sendMessage). The payload format is identical to what the
// Chrome path sends, so the background needs no changes.
//
// Protocol (all messages are plain window.postMessage on this page):
//   page  -> bridge : { channel: 'ig-bridge:request',  id, payload }
//   bridge -> page  : { channel: 'ig-bridge:response', id, response }
//                     { channel: 'ig-bridge:response', id, error }
//   bridge -> page  : { channel: 'ig-bridge:ready' }  (announced once on load)
(function () {
  'use strict';

  const REQUEST = 'ig-bridge:request';
  const RESPONSE = 'ig-bridge:response';
  const READY = 'ig-bridge:ready';

  // Announce presence so the page can detect the bridge early.
  try {
    window.postMessage({ channel: READY }, '*');
  } catch (_) {
    /* ignore */
  }

  window.addEventListener('message', (event) => {
    // Only accept messages posted by this same page.
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.channel !== REQUEST || typeof data.id !== 'string') return;

    const id = data.id;
    let settled = false;
    const reply = (extra) => {
      if (settled) return;
      settled = true;
      window.postMessage(Object.assign({ channel: RESPONSE, id }, extra), '*');
    };

    try {
      chrome.runtime.sendMessage(data.payload, (response) => {
        const err = chrome.runtime.lastError;
        if (err) reply({ error: err.message || 'bridge-error' });
        else reply({ response });
      });
    } catch (e) {
      reply({ error: (e && e.message) || String(e) });
    }
  });
})();
