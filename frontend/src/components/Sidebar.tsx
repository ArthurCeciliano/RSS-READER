import { useState } from 'react';
import type { FolderNode, SelectedScope } from '../types';
import { api, ApiError } from '../api/client';
import { deleteSourceConfirm, renameSourcePrompt } from '../sourceActions';
import { ContextMenu, type ContextMenuAction } from './ContextMenu';
import { MoveToFolderDialog } from './MoveToFolderDialog';
import './Sidebar.css';

interface SidebarProps {
  folders: FolderNode[];
  scope: SelectedScope;
  onSelectScope: (scope: SelectedScope) => void;
  onAddSource: () => void;
  onOpenSettings: () => void;
  onOpenHealth: () => void;
  onOpenRules: () => void;
  onOpenTags: () => void;
  onOpenStats: () => void;
  onFoldersChanged: () => void;
}

interface MenuState {
  x: number;
  y: number;
  actions: ContextMenuAction[];
}

function typeIcon(type: string): string {
  switch (type) {
    case 'youtube':
      return '▶';
    case 'instagram':
      return '◈';
    case 'tiktok':
      return '♪';
    case 'reddit':
      return '◉';
    default:
      return '●';
  }
}

export function Sidebar({
  folders,
  scope,
  onSelectScope,
  onAddSource,
  onOpenSettings,
  onOpenHealth,
  onOpenRules,
  onOpenTags,
  onOpenStats,
  onFoldersChanged,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [moveDialogSource, setMoveDialogSource] = useState<{ id: string; title: string } | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [dragOverSource, setDragOverSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const totalUnread = folders.reduce((sum, f) => sum + f.unreadCount, 0);

  function toggleFolder(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function reportError(err: unknown, fallback: string) {
    setError(err instanceof ApiError ? err.message : fallback);
    setTimeout(() => setError(null), 4000);
  }

  async function handleNewFolder() {
    const name = window.prompt('Nome da nova pasta:');
    if (!name?.trim()) return;
    try {
      await api.createFolder(name.trim());
      onFoldersChanged();
    } catch (err) {
      reportError(err, 'Falha ao criar pasta.');
    }
  }

  async function handleRenameFolder(folder: FolderNode) {
    const name = window.prompt('Renomear pasta:', folder.name);
    if (!name?.trim() || name.trim() === folder.name) return;
    try {
      await api.updateFolder(folder.id, { name: name.trim() });
      onFoldersChanged();
    } catch (err) {
      reportError(err, 'Falha ao renomear pasta.');
    }
  }

  async function handleDeleteFolder(folder: FolderNode) {
    if (!window.confirm(`Excluir a pasta "${folder.name}"? As fontes dentro dela ficam sem pasta.`)) return;
    try {
      await api.deleteFolder(folder.id);
      onFoldersChanged();
    } catch (err) {
      reportError(err, 'Falha ao excluir pasta.');
    }
  }

  async function handleRefreshFolder(folder: FolderNode) {
    try {
      await api.refreshAll(folder.id);
    } catch (err) {
      reportError(err, 'Falha ao atualizar pasta.');
    }
  }

  async function handleRenameSource(source: { id: string; title: string }) {
    try {
      if (await renameSourcePrompt(source.id, source.title)) onFoldersChanged();
    } catch (err) {
      reportError(err, 'Falha ao renomear fonte.');
    }
  }

  async function handleDeleteSource(source: { id: string; title: string }) {
    try {
      if (await deleteSourceConfirm(source.id, source.title)) onFoldersChanged();
    } catch (err) {
      reportError(err, 'Falha ao excluir fonte.');
    }
  }

  async function handleMoveSource(sourceId: string, folderId: string | null) {
    try {
      await api.updateSource(sourceId, { folderId });
      onFoldersChanged();
    } catch (err) {
      reportError(err, 'Falha ao mover fonte.');
    }
  }

  // Backend PATCH endpoints only ever write whatever sortOrder they're given —
  // nothing reindexes siblings server-side — so reordering means recomputing
  // sequential 0..n-1 values for the whole affected list and writing them all.
  async function handleReorderFolders(draggedId: string, targetId: string) {
    if (draggedId === targetId) return;
    const ids = folders.map((f) => f.id);
    const fromIndex = ids.indexOf(draggedId);
    const toIndex = ids.indexOf(targetId);
    if (fromIndex === -1 || toIndex === -1) return;
    ids.splice(toIndex, 0, ids.splice(fromIndex, 1)[0]);
    try {
      await Promise.all(ids.map((id, index) => api.updateFolder(id, { sortOrder: index })));
      onFoldersChanged();
    } catch (err) {
      reportError(err, 'Falha ao reordenar pastas.');
    }
  }

  async function handleReorderSource(draggedSourceId: string, targetFolder: FolderNode, targetSourceId: string) {
    if (draggedSourceId === targetSourceId) return;
    const movingFrom = folders.find((f) => f.sources.some((s) => s.id === draggedSourceId));
    const ids = targetFolder.sources.map((s) => s.id).filter((id) => id !== draggedSourceId);
    const toIndex = ids.indexOf(targetSourceId);
    ids.splice(toIndex, 0, draggedSourceId);
    const movingAcrossFolders = !movingFrom || movingFrom.id !== targetFolder.id;
    try {
      await Promise.all(
        ids.map((id, index) =>
          api.updateSource(id, {
            sortOrder: index,
            ...(id === draggedSourceId && movingAcrossFolders ? { folderId: targetFolder.id } : {}),
          }),
        ),
      );
      onFoldersChanged();
    } catch (err) {
      reportError(err, 'Falha ao reordenar fontes.');
    }
  }

  function openFolderMenu(e: React.MouseEvent, folder: FolderNode) {
    e.preventDefault();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      actions: [
        { label: 'Adicionar fonte aqui', onSelect: onAddSource },
        { label: 'Renomear pasta', onSelect: () => handleRenameFolder(folder) },
        { label: 'Atualizar agora', onSelect: () => handleRefreshFolder(folder) },
        { label: 'Excluir pasta', onSelect: () => handleDeleteFolder(folder), danger: true },
      ],
    });
  }

  function openSourceMenu(e: React.MouseEvent, source: FolderNode['sources'][number]) {
    e.preventDefault();
    e.stopPropagation();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      actions: [
        { label: 'Renomear', onSelect: () => handleRenameSource(source) },
        { label: 'Mover para pasta...', onSelect: () => setMoveDialogSource({ id: source.id, title: source.title }) },
        { label: 'Atualizar agora', onSelect: () => api.refreshSource(source.id).catch((err) => reportError(err, 'Falha ao atualizar.')) },
        { label: 'Excluir', onSelect: () => handleDeleteSource(source), danger: true },
      ],
    });
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">RSS Reader</span>
        <div className="sidebar-header-actions">
          <button className="sidebar-add-btn" title="Nova pasta" onClick={handleNewFolder}>
            📁+
          </button>
          <button className="sidebar-add-btn" title="Adicionar fonte" onClick={onAddSource}>
            +
          </button>
        </div>
      </div>

      {error && <div className="sidebar-error">{error}</div>}

      <nav className="sidebar-fixed-items">
        <button
          className={`sidebar-fixed-item ${scope.kind === 'all' ? 'active' : ''}`}
          onClick={() => onSelectScope({ kind: 'all', label: 'Todos os itens' })}
        >
          <span>Todos os itens</span>
          {totalUnread > 0 && <span className="badge">{totalUnread}</span>}
        </button>
        <button
          className={`sidebar-fixed-item ${scope.kind === 'starred' ? 'active' : ''}`}
          onClick={() => onSelectScope({ kind: 'starred', label: 'Itens estrelados' })}
        >
          <span>Itens estrelados</span>
        </button>
        <button className="sidebar-fixed-item" onClick={onOpenRules}>
          <span>Regras</span>
        </button>
        <button className="sidebar-fixed-item" onClick={onOpenTags}>
          <span>Tags</span>
        </button>
        <button className="sidebar-fixed-item" onClick={onOpenStats}>
          <span>Estatísticas</span>
        </button>
        <button className="sidebar-fixed-item" onClick={onOpenHealth}>
          <span>Saúde dos feeds</span>
        </button>
      </nav>

      <div className="sidebar-tree">
        {folders.map((folder) => {
          const isCollapsed = collapsed.has(folder.id);
          const isDragOver = dragOverFolder === folder.id;
          return (
            <div key={folder.id} className="folder-block">
              <button
                className={`folder-row ${isDragOver ? 'drag-over' : ''}`}
                draggable
                onClick={() => toggleFolder(folder.id)}
                onContextMenu={(e) => openFolderMenu(e, folder)}
                onDragStart={(e) => e.dataTransfer.setData('text/rss-folder-id', folder.id)}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverFolder(folder.id);
                }}
                onDragLeave={() => setDragOverFolder((prev) => (prev === folder.id ? null : prev))}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOverFolder(null);
                  const draggedFolderId = e.dataTransfer.getData('text/rss-folder-id');
                  if (draggedFolderId) {
                    handleReorderFolders(draggedFolderId, folder.id);
                    return;
                  }
                  const sourceId = e.dataTransfer.getData('text/rss-source-id');
                  if (sourceId) handleMoveSource(sourceId, folder.id);
                }}
              >
                <span className={`disclosure ${isCollapsed ? 'collapsed' : ''}`}>▾</span>
                <span
                  className="folder-name"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectScope({ kind: 'folder', id: folder.id, label: folder.name });
                  }}
                >
                  {folder.name}
                </span>
                {folder.unreadCount > 0 && <span className="badge">{folder.unreadCount}</span>}
              </button>
              {!isCollapsed && (
                <div className="source-list">
                  {folder.sources.map((source) => (
                    <button
                      key={source.id}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData('text/rss-source-id', source.id)}
                      className={`source-row ${scope.kind === 'source' && scope.id === source.id ? 'active' : ''} ${dragOverSource === source.id ? 'drag-over' : ''}`}
                      onClick={() => onSelectScope({ kind: 'source', id: source.id, label: source.title })}
                      onContextMenu={(e) => openSourceMenu(e, source)}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setDragOverSource(source.id);
                      }}
                      onDragLeave={() => setDragOverSource((prev) => (prev === source.id ? null : prev))}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setDragOverSource(null);
                        const draggedSourceId = e.dataTransfer.getData('text/rss-source-id');
                        if (draggedSourceId) handleReorderSource(draggedSourceId, folder, source.id);
                      }}
                    >
                      <span className="source-icon" aria-hidden>
                        {typeIcon(source.type)}
                      </span>
                      <span className="source-title">{source.title}</span>
                      {source.status !== 'ok' && <span className={`status-dot ${source.status}`} title={source.status} />}
                      {source.unreadCount > 0 && <span className="badge">{source.unreadCount}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button className="sidebar-settings-btn" onClick={onOpenSettings}>
        ⚙ Configurações
      </button>

      {menu && <ContextMenu x={menu.x} y={menu.y} actions={menu.actions} onClose={() => setMenu(null)} />}

      {moveDialogSource && (
        <MoveToFolderDialog
          folders={folders}
          sourceTitle={moveDialogSource.title}
          onClose={() => setMoveDialogSource(null)}
          onPick={(folderId) => {
            handleMoveSource(moveDialogSource.id, folderId);
            setMoveDialogSource(null);
          }}
        />
      )}
    </aside>
  );
}
