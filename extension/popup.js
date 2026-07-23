const cooldownEl = document.getElementById('cooldown');
const msgEl = document.getElementById('msg');
const foldersEl = document.getElementById('folders');

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'agora';
  if (mins < 60) return `há ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `há ${hours}h`;
  return `há ${Math.round(hours / 24)}d`;
}

function lastRunText(last) {
  if (!last) return { text: 'ainda não sincronizou', cls: 'muted' };
  const parts = [];
  if (last.newTotal > 0) parts.push(`${last.newTotal} novo(s)`);
  if (last.ok > 0) parts.push(`${last.ok} ok`);
  if (last.empty > 0) parts.push(`${last.empty} vazio(s)`);
  if (last.blocked > 0) parts.push(`${last.blocked} bloq.`);
  const body = parts.length ? parts.join(' · ') : 'nada novo';
  const cls = last.blocked > 0 || !last.completed ? 'error' : 'ok';
  return { text: `${body} — ${timeAgo(last.at)}`, cls };
}

function renderFolder(f) {
  const li = document.createElement('li');
  li.className = 'folder';

  const top = document.createElement('div');
  top.className = 'folder-top';

  const left = document.createElement('div');
  left.innerHTML =
    `<div class="folder-name">${f.name}</div>` +
    `<div class="folder-meta">${f.count} perfil(is) · ${(f.times || []).join(' · ') || 'sem horário'}</div>`;

  const btn = document.createElement('button');
  btn.className = 'sync';
  btn.textContent = 'Sincronizar';
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Sincronizando…';
    try {
      await chrome.runtime.sendMessage({ type: 'sync-folder', folderId: f.folderId });
    } finally {
      load();
    }
  });

  top.append(left, btn);

  const last = document.createElement('div');
  const { text, cls } = lastRunText(f.lastRun);
  last.className = `folder-last ${cls}`;
  last.textContent = text;

  li.append(top, last);
  return li;
}

async function load() {
  let plan;
  try {
    plan = await chrome.runtime.sendMessage({ type: 'get-plan' });
  } catch (err) {
    msgEl.textContent = `Erro: ${String(err?.message ?? err)}`;
    return;
  }

  if (!plan || !plan.configured) {
    msgEl.textContent = 'Configure a URL da API e o token nas Opções.';
    foldersEl.innerHTML = '';
    return;
  }
  if (plan.error) {
    msgEl.textContent = `Erro ao buscar pastas: ${plan.error}`;
    return;
  }

  if (plan.globalCooldownUntil && plan.globalCooldownUntil > Date.now()) {
    const mins = Math.ceil((plan.globalCooldownUntil - Date.now()) / 60000);
    cooldownEl.style.display = '';
    cooldownEl.textContent = `⏸ Instagram limitou a sessão. Em pausa, retoma em ~${mins} min. "Sincronizar" fura a pausa.`;
  } else {
    cooldownEl.style.display = 'none';
  }

  if (!plan.folders.length) {
    msgEl.textContent = 'Nenhuma pasta com perfis de Instagram. Coloque os perfis em pastas no app.';
    foldersEl.innerHTML = '';
    return;
  }

  msgEl.textContent = `${plan.folders.length} pasta(s) · atualização 3x/dia por pasta`;
  foldersEl.innerHTML = '';
  for (const f of plan.folders) foldersEl.appendChild(renderFolder(f));
}

load();
