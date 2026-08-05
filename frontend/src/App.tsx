import { useCallback, useEffect, useRef, useState } from 'react';
import './App.css';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { StoriesBar } from './components/StoriesBar';
import { ItemList } from './components/ItemList';
import { Reader } from './components/Reader';
import { AddSourceDialog } from './components/AddSourceDialog';
import { SettingsPage } from './components/SettingsPage';
import { HealthPage } from './components/HealthPage';
import { StatsPage } from './components/StatsPage';
import { RulesPage } from './components/RulesPage';
import { TagsPage } from './components/TagsPage';
import { MessagesPage } from './components/MessagesPage';
import { api } from './api/client';
import { playBeep, requestNotificationPermission, showDesktopNotification } from './notifications';
import type { FeedItem, FolderNode, ItemFilter, SelectedScope, SortOrder, SourceSummary, Tag, ViewMode } from './types';

const NOTIFICATION_POLL_MS = 20_000;

type PageView = 'reader-shell' | 'settings' | 'health' | 'rules' | 'tags' | 'stats' | 'messages';

// Minimal shape of the extension messaging API this app talks to (see
// extension/manifest.json's externally_connectable) — not a full chrome typings install.
interface ChromeRuntime {
  runtime: {
    sendMessage: (extensionId: string, message: unknown, callback: (response: unknown) => void) => void;
    lastError?: { message: string };
  };
}

// Public id of the Chrome extension (used only for the externally_connectable
// path). Falls back to this when the user hasn't configured a custom id.
const DEFAULT_CHROME_EXTENSION_ID = 'dgjgcjghhpmokjbiikdlpanbkcgbalpk';

// window.postMessage bridge protocol (see extension/bridge.js). Used on
// browsers without externally_connectable (e.g. Firefox): a content script
// injected into this page relays messages to/from the extension background.
const BRIDGE_REQUEST = 'ig-bridge:request';
const BRIDGE_RESPONSE = 'ig-bridge:response';
const BRIDGE_READY = 'ig-bridge:ready';

interface BridgeResponse {
  channel?: string;
  id?: string;
  response?: unknown;
  error?: string;
}

function hasChromeExtensionChannel(): boolean {
  const chromeApi = (window as unknown as { chrome?: ChromeRuntime }).chrome;
  return Boolean(chromeApi?.runtime && typeof chromeApi.runtime.sendMessage === 'function');
}

// Chrome path: talk to the extension directly via externally_connectable.
function callViaChrome(extensionId: string, message: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chromeApi = (window as unknown as { chrome?: ChromeRuntime }).chrome;
    if (!chromeApi?.runtime?.sendMessage) {
      reject(new Error('chrome-channel-unavailable'));
      return;
    }
    chromeApi.runtime.sendMessage(extensionId, message, (response) => {
      if (chromeApi.runtime.lastError) {
        reject(new Error(chromeApi.runtime.lastError.message));
        return;
      }
      resolve((response as Record<string, unknown>) || {});
    });
  });
}

// Bridge path: post the same payload the Chrome path would send and wait for
// the content script to relay the background's reply back on the same id.
function callViaBridge(message: unknown, timeoutMs = 60_000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const id = Math.random().toString(36).slice(2);
    const onMsg = (event: MessageEvent) => {
      const d = event.data as BridgeResponse | null;
      if (!d || d.channel !== BRIDGE_RESPONSE || d.id !== id) return;
      window.clearTimeout(timer);
      window.removeEventListener('message', onMsg);
      if (d.error) reject(new Error(d.error));
      else resolve((d.response as Record<string, unknown>) || {});
    };
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', onMsg);
      reject(new Error('bridge-timeout'));
    }, timeoutMs);
    window.addEventListener('message', onMsg);
    window.postMessage({ channel: BRIDGE_REQUEST, id, payload: message }, '*');
  });
}

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
  const [page, setPage] = useState<PageView>('stats');
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [instagramExtensionId, setInstagramExtensionId] = useState<string | null>(null);
  // Which source/folder ids are mid-sync (drives the per-row spinner in the sidebar).
  const [syncingIds, setSyncingIds] = useState<Set<string>>(new Set());
  const [folderSyncProgress, setFolderSyncProgress] = useState<{ folderId: string; index: number; total: number } | null>(null);
  const [markArticleAsReadSetting, setMarkArticleAsReadSetting] = useState<'on_display' | 'on_click' | 'manual'>('on_display');
  const [pendingDmCount, setPendingDmCount] = useState(0);
  const [notifiedDmIds] = useState<Set<string>>(() => new Set());
  // True once we've seen the postMessage bridge (Firefox). Lets us pick a long
  // timeout for real syncs while still failing fast when no extension exists.
  const bridgeReadyRef = useRef(false);

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
          tagId: scope.kind === 'tag' ? scope.id : undefined,
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

  // Detect the Firefox postMessage bridge early: it announces itself on load,
  // and we also probe once in case that signal fired before we mounted.
  useEffect(() => {
    const onReady = (event: MessageEvent) => {
      const d = event.data as { channel?: string } | null;
      if (d && d.channel === BRIDGE_READY) bridgeReadyRef.current = true;
    };
    window.addEventListener('message', onReady);
    callViaBridge({ type: 'get-status' }, 2500)
      .then(() => {
        bridgeReadyRef.current = true;
      })
      .catch(() => {
        /* no bridge on this page (Chrome, or extension not installed) */
      });
    return () => window.removeEventListener('message', onReady);
  }, []);

  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        setInstagramExtensionId((s.instagramExtensionId as string) || null);
        const mode = s.markArticleAsRead as 'on_display' | 'on_click' | 'manual' | undefined;
        if (mode === 'on_display' || mode === 'on_click' || mode === 'manual') setMarkArticleAsReadSetting(mode);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    requestNotificationPermission();
    const poll = setInterval(() => {
      api
        .getPendingNotifications()
        .then((r) => {
          for (const item of r.items) {
            if (item.pendingDesktopNotify) showDesktopNotification(item.title, item.source.title);
            if (item.pendingSound) playBeep();
            api.ackNotification(item.id).catch(() => {});
          }
        })
        .catch(() => {});

      // Instagram DMs have no per-conversation link to open directly (see
      // extension/background.js) — the notification just points at the
      // generic inbox, same as the Stories bar points at instagram.com/stories.
      // Never auto-acknowledged here (only a missed/dismissed toast used to
      // silently count as "seen" before) -- it stays pending, visible on the
      // Mensagens page, until the user actually clicks through to Instagram.
      api
        .getPendingDmPreviews()
        .then((r) => {
          setPendingDmCount(r.previews.length);
          for (const preview of r.previews) {
            if (notifiedDmIds.has(preview.id)) continue;
            notifiedDmIds.add(preview.id);
            showDesktopNotification(`Nova mensagem de ${preview.senderName}`, preview.previewText, () => {
              window.open('https://www.instagram.com/direct/inbox/', '_blank');
              api.ackDmPreview(preview.id).then(() => setPendingDmCount((c) => Math.max(0, c - 1))).catch(() => {});
            });
          }
        })
        .catch(() => {});
    }, NOTIFICATION_POLL_MS);
    return () => clearInterval(poll);
  }, []);

  useEffect(() => {
    if (page !== 'reader-shell') return;
    if (!searchQuery.trim()) {
      loadItems();
      return;
    }
    const handle = setTimeout(() => {
      api
        .searchItems(searchQuery.trim())
        .then((r) => {
          setItems(r.items);
          setNextCursor(null);
        })
        .catch(() => {});
    }, 300);
    return () => clearTimeout(handle);
  }, [loadItems, page, searchQuery]);

  function toggleStar(item: FeedItem) {
    const next = !item.isStarred;
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, isStarred: next } : i)));
    api.updateItem(item.id, { isStarred: next }).catch(() => {});
  }

  function markRead(item: FeedItem, isRead = true) {
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, isRead } : i)));

    // Optimistic sidebar badge update so it moves instantly instead of waiting on
    // a round-trip — loadFolders() below still reconciles with the server's count
    // once the PATCH has actually committed (it used to fire in parallel with the
    // update instead of after it, so it could race and refetch stale numbers).
    if (item.isRead !== isRead) {
      const delta = isRead ? -1 : 1;
      setFolders((prev) =>
        prev.map((f) => ({
          ...f,
          unreadCount: f.sources.some((s) => s.id === item.sourceId) ? Math.max(0, f.unreadCount + delta) : f.unreadCount,
          sources: f.sources.map((s) => (s.id === item.sourceId ? { ...s, unreadCount: Math.max(0, s.unreadCount + delta) } : s)),
        })),
      );
    }

    api.updateItem(item.id, { isRead }).then(loadFolders).catch(() => {});
  }

  async function deleteItem(item: FeedItem) {
    if (!window.confirm(`Apagar "${item.title}"?\n\nEle sai do seu feed definitivamente.`)) return;
    // Drop it from the list right away; the badge is reconciled by loadFolders().
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    if (selectedItem?.id === item.id) setSelectedItem(null);
    try {
      await api.deleteItem(item.id);
      loadFolders();
    } catch {
      loadItems(); // put it back if the server refused
    }
  }

  function openItem(item: FeedItem) {
    setSelectedItem(item);
    setSelectedIndex(items.findIndex((i) => i.id === item.id));
    if (!item.isRead && markArticleAsReadSetting !== 'manual') markRead(item, true);
  }

  function navigateReader(direction: 1 | -1) {
    const nextIndex = selectedIndex + direction;
    if (nextIndex < 0 || nextIndex >= items.length) return;
    setSelectedIndex(nextIndex);
    const item = items[nextIndex];
    setSelectedItem(item);
    if (!item.isRead && markArticleAsReadSetting !== 'manual') markRead(item, true);
  }

  function handleItemVisible(item: FeedItem) {
    if (markArticleAsReadSetting === 'on_display' && !item.isRead) markRead(item, true);
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

  function handleStoryViewed(sourceId: string) {
    setFolders((prev) =>
      prev.map((f) => ({ ...f, sources: f.sources.map((s) => (s.id === sourceId ? { ...s, storyAcknowledged: true } : s)) })),
    );
    api.updateSource(sourceId, { storyAcknowledged: true }).catch(() => {});
  }

  // Unified wrapper over the extension messaging. Prefers the Chrome path
  // (externally_connectable) and falls back to the postMessage bridge on
  // browsers without it (e.g. Firefox). Rejects with a friendly message only
  // when neither path can reach the extension.
  const EXTENSION_NOT_DETECTED =
    'Extensão não detectada neste navegador. Instale a extensão no Chrome ou no Firefox e tente novamente.';

  async function sendToExtension(message: unknown): Promise<Record<string, unknown>> {
    const extensionId = instagramExtensionId || DEFAULT_CHROME_EXTENSION_ID;

    // Preferred path on Chrome. If it fails (extension missing here), fall
    // through and let the bridge try.
    if (hasChromeExtensionChannel()) {
      try {
        return await callViaChrome(extensionId, message);
      } catch {
        /* fall through to the postMessage bridge */
      }
    }

    // Bridge path (Firefox). Confirm the bridge is actually present before
    // committing to a long-running request, so a browser with no extension
    // fails fast with a friendly message instead of hanging on the timeout.
    if (!bridgeReadyRef.current) {
      try {
        await callViaBridge({ type: 'get-status' }, 4000);
        bridgeReadyRef.current = true;
      } catch {
        throw new Error(EXTENSION_NOT_DETECTED);
      }
    }
    return callViaBridge(message);
  }

  function markSyncing(id: string, on: boolean) {
    setSyncingIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function syncInstagramSource(source: SourceSummary) {
    if (syncingIds.has(source.id)) return;
    markSyncing(source.id, true);
    try {
      const res = await sendToExtension({ type: 'sync-source', sourceId: source.id });
      if (res.ok === false) alert(String(res.error || 'Não foi possível sincronizar este perfil.'));
      loadItems();
      loadFolders();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      markSyncing(source.id, false);
    }
  }

  // Second, deliberately separate action: reads the account's MAIN profile feed
  // (the rate-limited surface), only ever per-profile. Tracked under a "feed:" key
  // so its spinner is independent from the post-page ⟳.
  async function syncInstagramSourceFeed(source: SourceSummary) {
    const key = `feed:${source.id}`;
    if (syncingIds.has(key)) return;
    markSyncing(key, true);
    try {
      const res = await sendToExtension({ type: 'sync-source-feed', sourceId: source.id });
      if (res.ok === false) alert(String(res.error || 'Não foi possível atualizar pelo feed do perfil.'));
      loadItems();
      loadFolders();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      markSyncing(key, false);
    }
  }

  async function syncInstagramFolder(folder: FolderNode) {
    if (syncingIds.has(folder.id)) return;
    markSyncing(folder.id, true);
    // Poll the extension for "i/total" progress while the folder run proceeds.
    const poll = window.setInterval(async () => {
      try {
        const st = await sendToExtension({ type: 'get-status' });
        const progress = st.progress as { activeFolderId: string; index: number; total: number } | null | undefined;
        if (progress && progress.activeFolderId === folder.id) {
          setFolderSyncProgress({ folderId: folder.id, index: progress.index, total: progress.total });
        }
      } catch {
        /* ignore transient polling errors */
      }
    }, 3000);
    try {
      const res = await sendToExtension({ type: 'sync-folder', folderId: folder.id });
      if (res.ok === false) alert(String(res.error || 'Não foi possível sincronizar a pasta.'));
      loadItems();
      loadFolders();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      window.clearInterval(poll);
      setFolderSyncProgress(null);
      markSyncing(folder.id, false);
    }
  }

  function handleSelectScope(next: SelectedScope) {
    setScope(next);
    setSearchQuery('');
    setPage('reader-shell');
  }

  function handleSelectTag(tag: Tag) {
    handleSelectScope({ kind: 'tag', id: tag.id, label: `#${tag.name}` });
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
              : page === 'messages'
                ? 'Mensagens'
                : searchQuery.trim()
                  ? `Busca: "${searchQuery.trim()}"`
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
        onOpenMessages={() => setPage('messages')}
        pendingDmCount={pendingDmCount}
        onFoldersChanged={loadFolders}
        onSyncInstagramSource={syncInstagramSource}
        onSyncInstagramSourceFeed={syncInstagramSourceFeed}
        onSyncInstagramFolder={syncInstagramFolder}
        syncingIds={syncingIds}
        folderSyncProgress={folderSyncProgress}
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
              searchQuery={searchQuery}
              onSearchQueryChange={setSearchQuery}
            />
            <StoriesBar folders={folders} scope={scope} onStoryViewed={handleStoryViewed} />
            <div className="app-content">
              <ItemList
                items={items}
                viewMode={viewMode}
                onOpenItem={openItem}
                onToggleStar={toggleStar}
                onDeleteItem={deleteItem}
                onLoadMore={() => nextCursor && loadItems(nextCursor)}
                hasMore={Boolean(nextCursor)}
                selectedItemId={selectedItem?.id}
                onItemVisible={markArticleAsReadSetting === 'on_display' ? handleItemVisible : undefined}
              />
            </div>
          </>
        )}

        {page === 'settings' && <SettingsPage />}
        {page === 'health' && <HealthPage folders={folders} onSourcesChanged={loadFolders} />}
        {page === 'rules' && <RulesPage />}
        {page === 'tags' && <TagsPage onSelectTag={handleSelectTag} />}
        {page === 'stats' && <StatsPage />}
        {page === 'messages' && (
          <MessagesPage
            onChanged={() => api.getPendingDmPreviews().then((r) => setPendingDmCount(r.previews.length))}
          />
        )}
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
