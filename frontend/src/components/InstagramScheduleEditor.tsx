import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { FolderNode } from '../types';

// Keep these in sync with the extension's background.js so auto-generated times
// match whether they're produced here (saved to the server) or filled in as a
// fallback by the extension for a folder that has no saved schedule yet.
const WINDOW_START_MIN = 8 * 60;
const WINDOW_END_MIN = 20 * 60;
const SLOTS_PER_FOLDER = 2;
const SCHEDULE_SETTING_KEY = 'instagramFolderSchedule';

type IgFolder = { folderId: string; name: string; count: number };
type Schedule = Record<string, string[]>;

const pad2 = (n: number) => String(n).padStart(2, '0');
const minutesToHHMM = (min: number) => {
  const m = ((min % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
};

function defaultTimesForIndex(i: number, n: number): string[] {
  const span = WINDOW_END_MIN - WINDOW_START_MIN;
  const half = Math.floor(span / SLOTS_PER_FOLDER);
  const step = n > 1 ? Math.floor(half / n) : 0;
  const first = WINDOW_START_MIN + step * i;
  return [minutesToHHMM(first), minutesToHHMM(first + half)];
}

function flattenIgFolders(nodes: FolderNode[], prefix: string, out: IgFolder[]): IgFolder[] {
  for (const n of nodes) {
    const path = prefix ? `${prefix} / ${n.name}` : n.name;
    const count = (n.sources || []).filter((s) => s.type === 'instagram').length;
    if (count > 0) out.push({ folderId: n.id, name: path, count });
    if (n.children?.length) flattenIgFolders(n.children, path, out);
  }
  return out;
}

export function InstagramScheduleEditor() {
  const [folders, setFolders] = useState<IgFolder[]>([]);
  const [schedule, setSchedule] = useState<Schedule>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState(false);

  useEffect(() => {
    Promise.all([api.getFolders(), api.getSettings()])
      .then(([{ folders: tree }, settings]) => {
        const flat = flattenIgFolders(tree, '', []).sort((a, b) => a.name.localeCompare(b.name));
        const saved = (settings[SCHEDULE_SETTING_KEY] as Schedule | undefined) || {};
        const next: Schedule = {};
        flat.forEach((f, i) => {
          const s = saved[f.folderId];
          next[f.folderId] = s && s.length ? s : defaultTimesForIndex(i, flat.length);
        });
        setFolders(flat);
        setSchedule(next);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Falha ao carregar pastas.'))
      .finally(() => setLoading(false));
  }, []);

  function setTime(folderId: string, slot: number, value: string) {
    setSchedule((prev) => {
      const times = [...(prev[folderId] || ['08:00', '20:00'])];
      times[slot] = value;
      return { ...prev, [folderId]: times };
    });
  }

  function autoDistribute() {
    const next: Schedule = {};
    folders.forEach((f, i) => {
      next[f.folderId] = defaultTimesForIndex(i, folders.length);
    });
    setSchedule(next);
  }

  async function save() {
    // Persist only folders that still exist, dropping schedules for deleted ones.
    const clean: Schedule = {};
    for (const f of folders) clean[f.folderId] = schedule[f.folderId] || defaultTimesForIndex(0, folders.length);
    await api.updateSettings({ [SCHEDULE_SETTING_KEY]: clean });
    setSavedMsg(true);
    setTimeout(() => setSavedMsg(false), 2500);
  }

  if (loading) return <p style={{ color: 'var(--text-secondary)', fontSize: 12.5 }}>Carregando pastas…</p>;
  if (error) return <p className="settings-error">Erro: {error}</p>;
  if (folders.length === 0) {
    return (
      <p style={{ color: 'var(--text-secondary)', fontSize: 12.5 }}>
        Nenhuma pasta com perfis de Instagram. Coloque os perfis em pastas para agendá-los.
      </p>
    );
  }

  return (
    <div className="ig-schedule">
      <p style={{ color: 'var(--text-secondary)', fontSize: 12.5, margin: '0 0 10px', lineHeight: 1.5 }}>
        Cada pasta é atualizada nos 2 horários abaixo. A extensão roda <strong>uma pasta por vez</strong>, então nunca
        atualiza tudo junto. Ajuste os horários para espalhá-los bem ao longo do dia (o botão abaixo já distribui
        automaticamente entre 08h e 20h para todas as pastas de uma vez).
      </p>

      <table className="ig-schedule-table">
        <thead>
          <tr>
            <th>Pasta</th>
            <th>Perfis</th>
            <th>Horário 1</th>
            <th>Horário 2</th>
          </tr>
        </thead>
        <tbody>
          {folders.map((f) => (
            <tr key={f.folderId}>
              <td className="ig-schedule-name">{f.name}</td>
              <td style={{ color: 'var(--text-secondary)' }}>{f.count}</td>
              <td>
                <input
                  type="time"
                  value={schedule[f.folderId]?.[0] ?? '08:00'}
                  onChange={(e) => setTime(f.folderId, 0, e.target.value)}
                />
              </td>
              <td>
                <input
                  type="time"
                  value={schedule[f.folderId]?.[1] ?? '20:00'}
                  onChange={(e) => setTime(f.folderId, 1, e.target.value)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 14 }}>
        <button onClick={autoDistribute}>Auto-distribuir horários</button>
        <button className="save-btn" onClick={save}>
          Salvar agendamento
        </button>
        {savedMsg && <span style={{ color: 'var(--accent)', fontSize: 12.5 }}>Salvo!</span>}
      </div>
    </div>
  );
}
