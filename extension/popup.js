const syncButton = document.getElementById('syncNow');
const lastRunEl = document.getElementById('lastRun');
const resultsEl = document.getElementById('results');

function render(lastRun) {
  if (!lastRun) {
    lastRunEl.textContent = 'Ainda não sincronizou.';
    resultsEl.innerHTML = '';
    return;
  }
  const when = new Date(lastRun.at).toLocaleString('pt-BR');
  lastRunEl.textContent = lastRun.error ? `Última tentativa: ${when} — erro: ${lastRun.error}` : `Última sincronização: ${when}`;
  resultsEl.innerHTML = (lastRun.results || [])
    .map((r) => {
      if (r.status === 'ok') {
        return `<li><span>${r.username}</span><span class="ok">${r.newItemCount} novo(s)</span></li>`;
      }
      return `<li><span>${r.username}</span><span class="error">${r.error}</span></li>`;
    })
    .join('');
}

async function load() {
  const { lastRun } = await chrome.storage.local.get(['lastRun']);
  render(lastRun);
}

syncButton.addEventListener('click', async () => {
  syncButton.disabled = true;
  syncButton.textContent = 'Sincronizando…';
  try {
    await chrome.runtime.sendMessage({ type: 'sync-now' });
  } finally {
    syncButton.disabled = false;
    syncButton.textContent = 'Sincronizar agora';
    load();
  }
});

load();
