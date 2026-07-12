import { useState } from 'react';
import type { FolderNode, SelectedScope } from '../types';
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
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const totalUnread = folders.reduce((sum, f) => sum + f.unreadCount, 0);

  function toggleFolder(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">RSS Reader</span>
        <button className="sidebar-add-btn" title="Adicionar fonte" onClick={onAddSource}>
          +
        </button>
      </div>

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
          return (
            <div key={folder.id} className="folder-block">
              <button className="folder-row" onClick={() => toggleFolder(folder.id)}>
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
                      className={`source-row ${scope.kind === 'source' && scope.id === source.id ? 'active' : ''}`}
                      onClick={() => onSelectScope({ kind: 'source', id: source.id, label: source.title })}
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
    </aside>
  );
}
