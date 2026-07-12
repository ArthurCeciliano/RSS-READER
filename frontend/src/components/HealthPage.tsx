import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { SourceHealth } from '../types';
import { relativeTime } from '../utils/relativeTime';
import { deleteSourceConfirm, renameSourcePrompt } from '../sourceActions';
import './HealthPage.css';

export function HealthPage() {
  const [sources, setSources] = useState<SourceHealth[]>([]);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api.getSourceHealth().then((r) => setSources(r.sources));
  }

  useEffect(load, []);

  function reportError(err: unknown, fallback: string) {
    setError(err instanceof ApiError ? err.message : fallback);
    setTimeout(() => setError(null), 4000);
  }

  async function handleRename(source: SourceHealth) {
    try {
      if (await renameSourcePrompt(source.id, source.title)) load();
    } catch (err) {
      reportError(err, 'Falha ao renomear fonte.');
    }
  }

  async function handleDelete(source: SourceHealth) {
    try {
      if (await deleteSourceConfirm(source.id, source.title)) load();
    } catch (err) {
      reportError(err, 'Falha ao excluir fonte.');
    }
  }

  async function handleRefresh(source: SourceHealth) {
    try {
      await api.refreshSource(source.id);
    } catch (err) {
      reportError(err, 'Falha ao atualizar fonte.');
    }
  }

  return (
    <div className="health-page">
      <h2>Saúde dos feeds</h2>
      {error && <p className="health-page-error">{error}</p>}
      <table className="health-table">
        <thead>
          <tr>
            <th>Fonte</th>
            <th>Tipo</th>
            <th>Status</th>
            <th>Última atualização OK</th>
            <th>Próxima tentativa</th>
            <th>Falhas seguidas</th>
            <th>Último erro</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          {sources.map((s) => (
            <tr key={s.id}>
              <td>{s.title}</td>
              <td>{s.type}</td>
              <td>
                <span className={`status-pill ${s.status}`}>{s.status}</span>
              </td>
              <td>{s.lastSuccessAt ? relativeTime(s.lastSuccessAt) : '—'}</td>
              <td>{s.nextFetchAt ? relativeTime(s.nextFetchAt) : '—'}</td>
              <td>{s.consecutiveFails}</td>
              <td className="health-error">{s.lastError ?? '—'}</td>
              <td className="health-actions">
                <button onClick={() => handleRefresh(s)} title="Atualizar agora">
                  ⟳
                </button>
                <button onClick={() => handleRename(s)} title="Renomear">
                  ✎
                </button>
                <button className="danger" onClick={() => handleDelete(s)} title="Excluir">
                  🗑
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
