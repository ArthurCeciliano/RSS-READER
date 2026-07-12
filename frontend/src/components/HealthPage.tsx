import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { SourceHealth } from '../types';
import { relativeTime } from '../utils/relativeTime';
import './HealthPage.css';

export function HealthPage() {
  const [sources, setSources] = useState<SourceHealth[]>([]);

  useEffect(() => {
    api.getSourceHealth().then((r) => setSources(r.sources));
  }, []);

  return (
    <div className="health-page">
      <h2>Saúde dos feeds</h2>
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
