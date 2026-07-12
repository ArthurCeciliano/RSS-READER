import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { FolderNode, SourceHealth } from '../types';
import { relativeTime } from '../utils/relativeTime';
import { deleteSourceConfirm, renameSourcePrompt } from '../sourceActions';
import { ContextMenu, type ContextMenuAction } from './ContextMenu';
import { MoveToFolderDialog } from './MoveToFolderDialog';
import './HealthPage.css';

interface HealthPageProps {
  folders: FolderNode[];
  onSourcesChanged: () => void;
}

interface MenuState {
  x: number;
  y: number;
  actions: ContextMenuAction[];
}

export function HealthPage({ folders, onSourcesChanged }: HealthPageProps) {
  const [sources, setSources] = useState<SourceHealth[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [moveDialogSource, setMoveDialogSource] = useState<{ id: string; title: string } | null>(null);

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
      if (await renameSourcePrompt(source.id, source.title)) {
        load();
        onSourcesChanged();
      }
    } catch (err) {
      reportError(err, 'Falha ao renomear fonte.');
    }
  }

  async function handleDelete(source: SourceHealth) {
    try {
      if (await deleteSourceConfirm(source.id, source.title)) {
        load();
        onSourcesChanged();
      }
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

  async function handleMove(sourceId: string, folderId: string | null) {
    try {
      await api.updateSource(sourceId, { folderId });
      onSourcesChanged();
    } catch (err) {
      reportError(err, 'Falha ao mover fonte.');
    }
  }

  function openRowMenu(e: React.MouseEvent, source: SourceHealth) {
    e.preventDefault();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      actions: [
        { label: 'Atualizar agora', onSelect: () => handleRefresh(source) },
        { label: 'Renomear', onSelect: () => handleRename(source) },
        { label: 'Mover para pasta...', onSelect: () => setMoveDialogSource({ id: source.id, title: source.title }) },
        { label: 'Excluir', onSelect: () => handleDelete(source), danger: true },
      ],
    });
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
            <tr key={s.id} onContextMenu={(e) => openRowMenu(e, s)}>
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

      {menu && <ContextMenu x={menu.x} y={menu.y} actions={menu.actions} onClose={() => setMenu(null)} />}

      {moveDialogSource && (
        <MoveToFolderDialog
          folders={folders}
          sourceTitle={moveDialogSource.title}
          onClose={() => setMoveDialogSource(null)}
          onPick={(folderId) => {
            handleMove(moveDialogSource.id, folderId);
            setMoveDialogSource(null);
          }}
        />
      )}
    </div>
  );
}
