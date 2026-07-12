import { useCallback, useEffect, useState } from 'react';
import './App.css';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { ItemList } from './components/ItemList';
import { Reader } from './components/Reader';
import { AddSourceDialog } from './components/AddSourceDialog';
import { SettingsPage } from './components/SettingsPage';
import { HealthPage } from './components/HealthPage';
import { Placeholder } from './components/Placeholder';
import { api } from './api/client';
import type { FeedItem, FolderNode, ItemFilter, SelectedScope, SortOrder, ViewMode } from './types';

type PageView = 'reader-shell' | 'settings' | 'health' | 'rules' | 'tags' | 'stats';

export default function App() {
  const [folders, setFolders] = useState<FolderNode[]>([]);
  const [scope, setScope] = useState<SelectedScope>({ kind: 'all', label: 'Todos os itens' });
  const [items, setItems] = useState<FeedItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('cards');
  const [sort, setSort] = useState<SortOrder>('newest');
  const [filter, setFilter] = useState<ItemFilter>('all');
  const [maxAgeDays, setMaxAgeDays] = useState<number | null>(null);
  const [selectedItem, setSelectedItem] = useState<FeedItem | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showAddSource, setShowAddSource] = useState(false);
  const [page, setPage] = useState<PageView>('reader-shell');
  const [refreshing, setRefreshing] = useState(false);

  const loadFolders = useCallback(() => {
    api.getFolders().then((r) => setFolders(r.folders)).catch(() => {});
  }, []);

  const loadItems = useCallback(
    (cursor?: string) => {
      const effectiveFilter = scope.kind === 'starred' ? 'starred' : filter;
      api
        .getItems({
          folderId: scope.kind === 'folder' ? scope.id : undefined,
          sourceId: scope.kind === 'source' ? scope.id : undefined,
          filter: effectiveFilter,
          sort,
          maxAgeDays: maxAgeDays ?? undefined,
          cursor,
        })
        .then((r) => {
          setItems((prev) => (cursor ? [...prev, ...r.items] : r.items));
          setNextCursor(r.nextCursor);
        })
        .catch(() => {});
    },
    [scope, filter, sort, maxAgeDays],
  );

  useEffect(() => {
    loadFolders();
  }, [loadFolders]);

  useEffect(() => {
    if (page === 'reader-shell') loadItems();
  }, [loadItems, page]);

  function toggleStar(item: FeedItem) {
    const next = !item.isStarred;
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, isStarred: next } : i)));
    api.updateItem(item.id, { isStarred: next }).catch(() => {});
  }

  function markRead(item: FeedItem, isRead = true) {
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, isRead } : i)));
    api.updateItem(item.id, { isRead }).catch(() => {});
    loadFolders();
  }

  function openItem(item: FeedItem) {
    setSelectedItem(item);
    setSelectedIndex(items.findIndex((i) => i.id === item.id));
    if (!item.isRead) markRead(item, true);
  }

  function navigateReader(direction: 1 | -1) {
    const nextIndex = selectedIndex + direction;
    if (nextIndex < 0 || nextIndex >= items.length) return;
    setSelectedIndex(nextIndex);
    const item = items[nextIndex];
    setSelectedItem(item);
    if (!item.isRead) markRead(item, true);
  }

  async function handleMarkAllRead() {
    await api.markAllRead({
      folderId: scope.kind === 'folder' ? scope.id : undefined,
      sourceId: scope.kind === 'source' ? scope.id : undefined,
    });
    loadItems();
    loadFolders();
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await api.refreshAll(scope.kind === 'folder' ? scope.id : undefined);
    } finally {
      setTimeout(() => setRefreshing(false), 1500);
    }
  }

  function handleSelectScope(next: SelectedScope) {
    setScope(next);
    setPage('reader-shell');
  }

  const scopeTitle =
    page === 'settings'
      ? 'Configurações'
      : page === 'health'
        ? 'Saúde dos feeds'
        : page === 'rules'
          ? 'Regras'
          : page === 'tags'
            ? 'Tags'
            : page === 'stats'
              ? 'Estatísticas'
              : scope.label;

  return (
    <div className="app-shell">
      <Sidebar
        folders={folders}
        scope={scope}
        onSelectScope={handleSelectScope}
        onAddSource={() => setShowAddSource(true)}
        onOpenSettings={() => setPage('settings')}
        onOpenHealth={() => setPage('health')}
        onOpenRules={() => setPage('rules')}
        onOpenTags={() => setPage('tags')}
        onOpenStats={() => setPage('stats')}
        onFoldersChanged={loadFolders}
      />

      <div className="app-main">
        {page === 'reader-shell' && (
          <>
            <TopBar
              scopeLabel={scopeTitle}
              sort={sort}
              onSortChange={setSort}
              maxAgeDays={maxAgeDays}
              onMaxAgeChange={setMaxAgeDays}
              filter={filter}
              onFilterChange={setFilter}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              onMarkAllRead={handleMarkAllRead}
              onRefresh={handleRefresh}
              refreshing={refreshing}
            />
            <div className="app-content">
              <ItemList
                items={items}
                viewMode={viewMode}
                onOpenItem={openItem}
                onToggleStar={toggleStar}
                onLoadMore={() => nextCursor && loadItems(nextCursor)}
                hasMore={Boolean(nextCursor)}
                selectedItemId={selectedItem?.id}
              />
            </div>
          </>
        )}

        {page === 'settings' && <SettingsPage />}
        {page === 'health' && <HealthPage folders={folders} onSourcesChanged={loadFolders} />}
        {page === 'rules' && (
          <Placeholder title="Regras" description="Motor de regras SE/ENTÃO chega na Fase 2." />
        )}
        {page === 'tags' && <Placeholder title="Tags" description="Gestão de tags chega na Fase 2." />}
        {page === 'stats' && <Placeholder title="Estatísticas" description="Estatísticas chegam na Fase 2." />}
      </div>

      {selectedItem && (
        <Reader
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onToggleStar={toggleStar}
          onNext={() => navigateReader(1)}
          onPrev={() => navigateReader(-1)}
        />
      )}

      {showAddSource && (
        <AddSourceDialog folders={folders} onClose={() => setShowAddSource(false)} onAdded={loadFolders} />
      )}
    </div>
  );
}
