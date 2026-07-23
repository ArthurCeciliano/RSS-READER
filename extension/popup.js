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
  if (last.noSeed > 0) parts.push(`${last.noSeed} sem semente`);
  const body = parts.length ? parts.join(' · ') : 'nada novo';
  const cls = last.blocked > 0 || !last.completed ? 'error' : 'ok';
  return { text: `${body} — ${timeAgo(last.at)}`, cls };
}

function renderFolder(f, active) {
  const li = document.createElement('li');
  li.className = 'folder';

  const top = document.createElement('div');
  top.className = 'folder-top';

  const left = document.createElement('div');
  left.innerHTML =
    `<div class="folder-name">${f.name}</div>` +
    `<div class="folder-meta">${f.count} perfil(is) · ${(f.times || []).join(' · ') || 'sem horário'}</div>`;

  const isActive = active && active.folderId === f.folderId;
  const btn = document.createElement('button');
  btn.className = 'sync';
  btn.disabled = Boolean(active);
  btn.textContent = isActive ? 'Em andamento…' : 'Sincronizar';
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Lendo 1º perfil…';
    try {
      const r = await chrome.runtime.sendMessage({ type: 'sync-folder', folderId: f.folderId });
      if (r && r.ok === false) {
        msgEl.textContent = r.error || 'Não foi possível iniciar.';
      } else if (r && r.first) {
        const p = r.first;
        const bits = [];
        if (p.newTotal) bits.push(`${p.newTotal} novo(s)`);
        if (p.ok) bits.push('leu ok');
        if (p.blocked) bits.push('bloqueado');
        if (p.empty) bits.push('vazio');
        if (p.noSeed) bits.push('sem semente');
        msgEl.textContent = `1º perfil: ${bits.join(' · ') || 'ok'}${r.started ? ' · resto em segundo plano' : ''}`;
      }
    } finally {
      setTimeout(load, 900);
    }
  });

  top.append(left, btn);

  const last = document.createElement('div');
  if (isActive) {
    last.className = 'folder-last ok';
    const prog = active.progress ? ` (${active.progress.index}/${active.progress.total})` : '';
    last.textContent = `sincronizando${prog}… 1 perfil a cada 1–3 min`;
  } else {
    const { text, cls } = lastRunText(f.lastRun);
    last.className = `folder-last ${cls}`;
    last.textContent = text;
  }

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

  const active = plan.activeFolderId ? { folderId: plan.activeFolderId, progress: plan.activeProgress } : null;
  if (!active || msgEl.textContent === 'carregando…') {
    msgEl.textContent = active ? 'Sincronização em andamento…' : `${plan.folders.length} pasta(s) · 3x/dia por pasta`;
  }
  foldersEl.innerHTML = '';
  for (const f of plan.folders) foldersEl.appendChild(renderFolder(f, active));
}

load();
