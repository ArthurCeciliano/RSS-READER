const statusEl = document.getElementById('status');

async function load() {
  let res;
  try {
    res = await chrome.runtime.sendMessage({ type: 'get-status' });
  } catch (err) {
    statusEl.className = 'error';
    statusEl.textContent = `Erro: ${String(err?.message ?? err)}`;
    return;
  }

  if (!res || !res.configured) {
    statusEl.className = 'error';
    statusEl.textContent = 'Conexão não configurada. Abra as Opções e salve a URL da API + token.';
    return;
  }

  statusEl.className = 'ok';
  if (res.progress && res.progress.total) {
    statusEl.textContent = `Sincronizando uma pasta… (${res.progress.index + 1}/${res.progress.total})`;
  } else {
    statusEl.textContent = 'Conectado. Pronto para sincronizar pelo app.';
  }
}

load();
