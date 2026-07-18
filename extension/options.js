const apiBaseUrlInput = document.getElementById('apiBaseUrl');
const apiTokenInput = document.getElementById('apiToken');
const syncIntervalInput = document.getElementById('syncIntervalMinutes');
const statusEl = document.getElementById('status');

async function load() {
  const { apiBaseUrl, apiToken, syncIntervalMinutes } = await chrome.storage.local.get([
    'apiBaseUrl',
    'apiToken',
    'syncIntervalMinutes',
  ]);
  if (apiBaseUrl) apiBaseUrlInput.value = apiBaseUrl;
  if (apiToken) apiTokenInput.value = apiToken;
  if (syncIntervalMinutes) syncIntervalInput.value = syncIntervalMinutes;
}

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = kind;
}

document.getElementById('save').addEventListener('click', async () => {
  const apiBaseUrl = apiBaseUrlInput.value.trim().replace(/\/$/, '');
  const apiToken = apiTokenInput.value.trim();
  const syncIntervalMinutes = Math.max(15, Number(syncIntervalInput.value) || 25);

  let origin;
  try {
    origin = new URL(apiBaseUrl).origin;
  } catch {
    setStatus('URL da API inválida.', 'error');
    return;
  }
  if (!apiToken) {
    setStatus('Token é obrigatório.', 'error');
    return;
  }

  // Must run inside this click handler — chrome.permissions.request requires a user gesture.
  const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
  if (!granted) {
    setStatus('Permissão negada — a extensão não vai conseguir falar com o servidor.', 'error');
    return;
  }

  await chrome.storage.local.set({ apiBaseUrl, apiToken, syncIntervalMinutes });
  await chrome.runtime.sendMessage({ type: 'reschedule' });
  setStatus('Salvo. Sincronizando agora…', 'ok');
  const result = await chrome.runtime.sendMessage({ type: 'sync-now' });
  setStatus(result?.ok ? 'Salvo e sincronizado.' : 'Salvo, mas a sincronização falhou — confira o popup.', 'ok');
});

load();
