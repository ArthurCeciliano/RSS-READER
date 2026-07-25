import { useState } from 'react';
import type { FolderNode, SelectedScope, SourceSummary } from '../types';
import { api, ApiError } from '../api/client';
import { deleteSourceConfirm, renameSourcePrompt } from '../sourceActions';
import { flattenFolderNodes } from '../folderTree';
import { ContextMenu, type ContextMenuAction } from './ContextMenu';
import { MoveToFolderDialog } from './MoveToFolderDialog';
import { MoveFolderDialog } from './MoveFolderDialog';
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
  onOpenMessages: () => void;
  pendingDmCount: number;
  onFoldersChanged: () => void;
  onSyncInstagramSource: (source: SourceSummary) => void;
  onSyncInstagramSourceFeed: (source: SourceSummary) => void;
  onSyncInstagramFolder: (folder: FolderNode) => void;
  syncingIds: Set<string>;
  folderSyncProgress: { folderId: string; index: number; total: number } | null;
}

/** A folder gets a manual IG sync button only when it holds Instagram profiles
 *  DIRECTLY and has no subfolders — syncing a whole tree at once is exactly the
 *  volume that gets the account rate-limited, so parent folders don't get one. */
function isInstagramLeafFolder(folder: FolderNode): boolean {
  return folder.children.length === 0 && folder.sources.some((s) => s.type === 'instagram');
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

interface FolderItemProps {
  folder: FolderNode;
  scope: SelectedScope;
  expanded: Set<string>;
  dragOverFolder: string | null;
  dragOverSource: string | null;
  onToggleFolder: (id: string) => void;
  onSelectScope: (scope: SelectedScope) => void;
  onSetDragOverFolder: (id: string | null) => void;
  onSetDragOverSource: (id: string | null) => void;
  onOpenFolderMenu: (e: React.MouseEvent, folder: FolderNode) => void;
  onOpenSourceMenu: (e: React.MouseEvent, source: FolderNode['sources'][number]) => void;
  onReorderFolders: (draggedId: string, targetId: string) => void;
  onMoveSource: (sourceId: string, folderId: string | null) => void;
  onReorderSource: (draggedSourceId: string, targetFolder: FolderNode, targetSourceId: string) => void;
  onSyncInstagramSource: (source: SourceSummary) => void;
  onSyncInstagramSourceFeed: (source: SourceSummary) => void;
  onSyncInstagramFolder: (folder: FolderNode) => void;
  syncingIds: Set<string>;
  folderSyncProgress: { folderId: string; index: number; total: number } | null;
}

/** Renders itself for `folder.children` so a folder can nest other folders,
 *  not just hold sources directly — indentation comes for free from the
 *  normal nested DOM structure (.subfolder-list/.source-list padding) rather
 *  than computed per-depth pixel math. */
function FolderItem({
  folder,
  scope,
  expanded,
  dragOverFolder,
  dragOverSource,
  onToggleFolder,
  onSelectScope,
  onSetDragOverFolder,
  onSetDragOverSource,
  onOpenFolderMenu,
  onOpenSourceMenu,
  onReorderFolders,
  onMoveSource,
  onReorderSource,
  onSyncInstagramSource,
  onSyncInstagramSourceFeed,
  onSyncInstagramFolder,
  syncingIds,
  folderSyncProgress,
}: FolderItemProps) {
  const isCollapsed = !expanded.has(folder.id);
  const isDragOver = dragOverFolder === folder.id;
  const showFolderSync = isInstagramLeafFolder(folder);
  const folderSyncing = syncingIds.has(folder.id);
  const folderProgress = folderSyncProgress?.folderId === folder.id ? folderSyncProgress : null;

  return (
    <div className="folder-block">
      <button
        className={`folder-row ${isDragOver ? 'drag-over' : ''}`}
        draggable
        onClick={() => onToggleFolder(folder.id)}
        onContextMenu={(e) => onOpenFolderMenu(e, folder)}
        onDragStart={(e) => e.dataTransfer.setData('text/rss-folder-id', folder.id)}
        onDragOver={(e) => {
          e.preventDefault();
          onSetDragOverFolder(folder.id);
        }}
        onDragLeave={() => onSetDragOverFolder(null)}
        onDrop={(e) => {
          e.preventDefault();
          onSetDragOverFolder(null);
          const draggedFolderId = e.dataTransfer.getData('text/rss-folder-id');
          if (draggedFolderId) {
            onReorderFolders(draggedFolderId, folder.id);
            return;
          }
          const sourceId = e.dataTransfer.getData('text/rss-source-id');
          if (sourceId) onMoveSource(sourceId, folder.id);
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
        {showFolderSync && (
          <span
            className={`row-sync-btn ${folderSyncing ? (folderProgress ? 'active' : 'spinning') : ''}`}
            role="button"
            tabIndex={0}
            title={folderSyncing ? 'Sincronizando os perfis desta pasta…' : 'Sincronizar todos os perfis de Instagram desta pasta'}
            onClick={(e) => {
              e.stopPropagation();
              if (!folderSyncing) onSyncInstagramFolder(folder);
            }}
          >
            {folderProgress ? `${folderProgress.index + 1}/${folderProgress.total}` : '⟳'}
          </span>
        )}
      </button>
      {!isCollapsed && (
        <>
          {folder.children.length > 0 && (
            <div className="subfolder-list">
              {folder.children.map((child) => (
                <FolderItem
                  key={child.id}
                  folder={child}
                  scope={scope}
                  expanded={expanded}
                  dragOverFolder={dragOverFolder}
                  dragOverSource={dragOverSource}
                  onToggleFolder={onToggleFolder}
                  onSelectScope={onSelectScope}
                  onSetDragOverFolder={onSetDragOverFolder}
                  onSetDragOverSource={onSetDragOverSource}
                  onOpenFolderMenu={onOpenFolderMenu}
                  onOpenSourceMenu={onOpenSourceMenu}
                  onReorderFolders={onReorderFolders}
                  onMoveSource={onMoveSource}
                  onReorderSource={onReorderSource}
                  onSyncInstagramSource={onSyncInstagramSource}
                  onSyncInstagramSourceFeed={onSyncInstagramSourceFeed}
                  onSyncInstagramFolder={onSyncInstagramFolder}
                  syncingIds={syncingIds}
                  folderSyncProgress={folderSyncProgress}
                />
              ))}
            </div>
          )}
          <div className="source-list">
            {folder.sources.map((source) => (
              <button
                key={source.id}
                draggable
                onDragStart={(e) => e.dataTransfer.setData('text/rss-source-id', source.id)}
                className={`source-row ${scope.kind === 'source' && scope.id === source.id ? 'active' : ''} ${dragOverSource === source.id ? 'drag-over' : ''}`}
                onClick={() => onSelectScope({ kind: 'source', id: source.id, label: source.title })}
                onContextMenu={(e) => onOpenSourceMenu(e, source)}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onSetDragOverSource(source.id);
                }}
                onDragLeave={() => onSetDragOverSource(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onSetDragOverSource(null);
                  const draggedSourceId = e.dataTransfer.getData('text/rss-source-id');
                  if (draggedSourceId) onReorderSource(draggedSourceId, folder, source.id);
                }}
              >
                <span className="source-icon" aria-hidden>
                  {typeIcon(source.type)}
                </span>
                <span className="source-title">{source.title}</span>
                {source.status !== 'ok' && <span className={`status-dot ${source.status}`} title={source.status} />}
                {source.unreadCount > 0 && <span className="badge">{source.unreadCount}</span>}
                {source.type === 'instagram' && (
                  <>
                    <span
                      className={`row-sync-btn feed-sync ${syncingIds.has(`feed:${source.id}`) ? 'spinning' : ''}`}
                      role="button"
                      tabIndex={0}
                      title={
                        syncingIds.has(`feed:${source.id}`)
                          ? 'Abrindo o feed do perfil…'
                          : 'Atualizar pelo feed do perfil — abre o perfil (use com moderação)'
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!syncingIds.has(`feed:${source.id}`)) onSyncInstagramSourceFeed(source);
                      }}
                    >
                      ▦
                    </span>
                    <span
                      className={`row-sync-btn ${syncingIds.has(source.id) ? 'spinning' : ''}`}
                      role="button"
                      tabIndex={0}
                      title={syncingIds.has(source.id) ? 'Sincronizando…' : 'Sincronizar (pela página do post)'}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!syncingIds.has(source.id)) onSyncInstagramSource(source);
                      }}
                    >
                      ⟳
                    </span>
                  </>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
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
  onOpenMessages,
  pendingDmCount,
  onFoldersChanged,
  onSyncInstagramSource,
  onSyncInstagramSourceFeed,
  onSyncInstagramFolder,
  syncingIds,
  folderSyncProgress,
}: SidebarProps) {
  // Tracks which folders were explicitly opened, rather than which are
  // collapsed, so an empty set (the initial state, and the state for any
  // folder never clicked) means "closed by default" instead of needing to
  // know the folder list up front to pre-populate a "collapsed" set.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [moveDialogSource, setMoveDialogSource] = useState<{ id: string; title: string } | null>(null);
  const [moveDialogFolder, setMoveDialogFolder] = useState<FolderNode | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [dragOverSource, setDragOverSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const totalUnread = folders.reduce((sum, f) => sum + f.unreadCount, 0);

  function toggleFolder(id: string) {
    setExpanded((prev) => {
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
    // Cascades in the DB: deleting a folder with subfolders deletes those too
    // (their sources just lose their folder), not just this folder's own sources.
    const message =
      folder.children.length > 0
        ? `Excluir a pasta "${folder.name}"? Isso também exclui as ${folder.children.length} subpasta(s) dentro dela (as fontes ficam sem pasta).`
        : `Excluir a pasta "${folder.name}"? As fontes dentro dela ficam sem pasta.`;
    if (!window.confirm(message)) return;
    try {
      await api.deleteFolder(folder.id);
      onFoldersChanged();
    } catch (err) {
      reportError(err, 'Falha ao excluir pasta.');
    }
  }

  async function handleNewSubfolder(parentFolder: FolderNode) {
    const name = window.prompt(`Nova subpasta dentro de "${parentFolder.name}":`);
    if (!name?.trim()) return;
    try {
      await api.createFolder(name.trim(), parentFolder.id);
      onFoldersChanged();
    } catch (err) {
      reportError(err, 'Falha ao criar subpasta.');
    }
  }

  async function handleMoveFolder(folderId: string, parentId: string | null) {
    try {
      await api.updateFolder(folderId, { parentId });
      onFoldersChanged();
    } catch (err) {
      reportError(err, 'Falha ao mover pasta.');
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
  // Only reorders among siblings (same parent) -- moving a folder to a
  // DIFFERENT parent is the separate explicit "Mover para dentro de..." action,
  // not something a plain drag-and-drop should do implicitly.
  async function handleReorderFolders(draggedId: string, targetId: string) {
    if (draggedId === targetId) return;
    const allFolders = flattenFolderNodes(folders);
    const dragged = allFolders.find((f) => f.id === draggedId);
    const target = allFolders.find((f) => f.id === targetId);
    if (!dragged || !target || dragged.parentId !== target.parentId) return;
    const siblings = allFolders.filter((f) => f.parentId === target.parentId);
    const ids = siblings.map((f) => f.id);
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
        { label: 'Nova subpasta aqui', onSelect: () => handleNewSubfolder(folder) },
        { label: 'Renomear pasta', onSelect: () => handleRenameFolder(folder) },
        { label: 'Mover para dentro de...', onSelect: () => setMoveDialogFolder(folder) },
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
        {
          label: source.type === 'instagram' ? 'Sincronizar Instagram' : 'Atualizar agora',
          onSelect: () =>
            source.type === 'instagram'
              ? onSyncInstagramSource(source)
              : api.refreshSource(source.id).catch((err) => reportError(err, 'Falha ao atualizar.')),
        },
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
        <button className="sidebar-fixed-item" onClick={onOpenMessages}>
          <span>Mensagens</span>
          {pendingDmCount > 0 && <span className="badge">{pendingDmCount}</span>}
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
        {folders.map((folder) => (
          <FolderItem
            key={folder.id}
            folder={folder}
            scope={scope}
            expanded={expanded}
            dragOverFolder={dragOverFolder}
            dragOverSource={dragOverSource}
            onToggleFolder={toggleFolder}
            onSelectScope={onSelectScope}
            onSetDragOverFolder={setDragOverFolder}
            onSetDragOverSource={setDragOverSource}
            onOpenFolderMenu={openFolderMenu}
            onOpenSourceMenu={openSourceMenu}
            onReorderFolders={handleReorderFolders}
            onMoveSource={handleMoveSource}
            onReorderSource={handleReorderSource}
            onSyncInstagramSource={onSyncInstagramSource}
            onSyncInstagramSourceFeed={onSyncInstagramSourceFeed}
            onSyncInstagramFolder={onSyncInstagramFolder}
            syncingIds={syncingIds}
            folderSyncProgress={folderSyncProgress}
          />
        ))}
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

      {moveDialogFolder && (
        <MoveFolderDialog
          folders={folders}
          folder={moveDialogFolder}
          onClose={() => setMoveDialogFolder(null)}
          onPick={(parentId) => {
            handleMoveFolder(moveDialogFolder.id, parentId);
            setMoveDialogFolder(null);
          }}
        />
      )}
    </aside>
  );
}
