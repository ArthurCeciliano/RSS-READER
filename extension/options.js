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

  await chrome.storage.local.set({ apiBaseUrl, apiToken });
  setStatus('Conexão salva. Sincronize pelos botões dentro do app (perfil ou pasta).', 'ok');
});

load();
