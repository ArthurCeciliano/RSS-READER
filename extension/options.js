const apiBaseUrlInput = document.getElementById('apiBaseUrl');
const apiTokenInput = document.getElementById('apiToken');
const statusEl = document.getElementById('status');

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = kind || '';
}

async function load() {
  const { apiBaseUrl, apiToken } = await chrome.storage.local.get(['apiBaseUrl', 'apiToken']);
  if (apiBaseUrl) apiBaseUrlInput.value = apiBaseUrl;
  if (apiToken) apiTokenInput.value = apiToken;
}

document.getElementById('save').addEventListener('click', async () => {
  const apiBaseUrl = apiBaseUrlInput.value.trim().replace(/\/$/, '');
  const apiToken = apiTokenInput.value.trim();

  let origin;
  try {
    origin = new URL(apiBaseUrl).origin;
  } catch {
    setStatus('URL da API inválida.', 'error');
    alert('URL da API inválida.');
    return;
  }
  if (!apiToken) {
    setStatus('Token é obrigatório.', 'error');
    alert('Token é obrigatório.');
    return;
  }

  // Save FIRST so the connection persists no matter what. The API host is already
  // granted via host_permissions in the manifest, so no permission prompt is needed
  // (that finicky prompt was the whole reason "Salvar" seemed to do nothing).
  await chrome.storage.local.set({ apiBaseUrl, apiToken });
  // Best-effort extra grant only if the server host differs from the baked-in one.
  try {
    await chrome.permissions.request({ origins: [`${origin}/*`] });
  } catch {
    /* ignore */
  }

  setStatus('✓ Conexão salva! Pode fechar esta aba e sincronizar pelo app.', 'ok');
  alert('✓ Conexão salva!');
});

load();
