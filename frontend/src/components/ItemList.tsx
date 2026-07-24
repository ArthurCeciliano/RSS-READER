import { useEffect, useRef } from 'react';
import type { FeedItem, ViewMode } from '../types';
import { relativeTime } from '../utils/relativeTime';
import './ItemList.css';

interface ItemListProps {
  items: FeedItem[];
  viewMode: ViewMode;
  onOpenItem: (item: FeedItem) => void;
  onToggleStar: (item: FeedItem) => void;
  onDeleteItem: (item: FeedItem) => void;
  onLoadMore: () => void;
  hasMore: boolean;
  selectedItemId?: string;
  /** Called once per item the first time it scrolls into view (only wired up when the
   *  "Mark article as read" setting is on_display — undefined disables scroll-tracking). */
  onItemVisible?: (item: FeedItem) => void;
}

/** Marks each not-yet-read item read the first time ~half of its card/row has scrolled
 *  into view, so a fast scan through a big grid of posts counts as "read" without
 *  clicking into every single one. One shared IntersectionObserver for the whole list. */
function useMarkVisibleAsRead(items: FeedItem[], onItemVisible?: (item: FeedItem) => void) {
  const observerRef = useRef<IntersectionObserver | null>(null);
  const nodeToItemId = useRef(new Map<Element, string>());
  const notifiedIds = useRef(new Set<string>());
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const onItemVisibleRef = useRef(onItemVisible);
  onItemVisibleRef.current = onItemVisible;

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const id = nodeToItemId.current.get(entry.target);
          if (!id || notifiedIds.current.has(id)) continue;
          const item = itemsRef.current.find((i) => i.id === id);
          if (!item || item.isRead) continue;
          notifiedIds.current.add(id);
          observer.unobserve(entry.target);
          onItemVisibleRef.current?.(item);
        }
      },
      { threshold: 0.5 },
    );
    observerRef.current = observer;
    return () => observer.disconnect();
  }, []);

  return (node: Element | null, item: FeedItem) => {
    if (!node || !observerRef.current || item.isRead || notifiedIds.current.has(item.id)) return;
    nodeToItemId.current.set(node, item.id);
    observerRef.current.observe(node);
  };
}

function ItemMeta({ item }: { item: FeedItem }) {
  return (
    <div className="item-meta">
      <span className="item-source">{item.source.title}</span>
      <span className="item-time">{relativeTime(item.publishedAt ?? item.createdAt)}</span>
    </div>
  );
}

export function ItemList({
  items,
  viewMode,
  onOpenItem,
  onToggleStar,
  onDeleteItem,
  onLoadMore,
  hasMore,
  selectedItemId,
  onItemVisible,
}: ItemListProps) {
  const registerVisibilityNode = useMarkVisibleAsRead(items, onItemVisible);

  if (viewMode === 'cards') {
    return (
      <div className="item-grid">
        {items.map((item) => (
          <article
            key={item.id}
            ref={(node) => registerVisibilityNode(node, item)}
            className={`item-card ${item.isRead ? 'read' : ''} ${selectedItemId === item.id ? 'selected' : ''}`}
            onClick={() => onOpenItem(item)}
          >
            {item.imageUrl && (
              <div className="item-card-image" style={{ backgroundImage: `url(${item.imageUrl})` }}>
                {item.source.type === 'youtube' && <span className="play-overlay">▶</span>}
              </div>
            )}
            <div className="item-card-body">
              <h3 className="item-card-title">{item.title}</h3>
              <ItemMeta item={item} />
              {item.summary && <p className="item-card-summary">{item.summary}</p>}
            </div>
            <div className="item-card-actions">
              {item.link && (
                <a
                  className="external-link-btn"
                  href={item.link}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  title="Abrir original em nova aba"
                >
                  ↗
                </a>
              )}
              <button
                className={`star-btn ${item.isStarred ? 'starred' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleStar(item);
                }}
                title="Estrela"
              >
                ★
              </button>
              <button
                className="delete-item-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteItem(item);
                }}
                title="Apagar este post"
              >
                🗑
              </button>
            </div>
          </article>
        ))}
        {hasMore && (
          <button className="load-more" onClick={onLoadMore}>
            Carregar mais
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`item-list ${viewMode === 'three-pane' ? 'three-pane-list' : ''}`}>
      {items.map((item) => (
        <div
          key={item.id}
          ref={(node) => registerVisibilityNode(node, item)}
          className={`item-row ${item.isRead ? 'read' : ''} ${selectedItemId === item.id ? 'selected' : ''}`}
          onClick={() => onOpenItem(item)}
        >
          <button
            className={`star-btn ${item.isStarred ? 'starred' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleStar(item);
            }}
          >
            ★
          </button>
          {item.imageUrl && (
            <div className="item-row-image" style={{ backgroundImage: `url(${item.imageUrl})` }}>
              {item.source.type === 'youtube' && <span className="play-overlay small">▶</span>}
            </div>
          )}
          <div className="item-row-body">
            <span className="item-row-title">{item.title}</span>
            <ItemMeta item={item} />
            {viewMode === 'summary' && item.summary && <p className="item-row-summary">{item.summary}</p>}
          </div>
          {item.link && (
            <a
              className="external-link-btn"
              href={item.link}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              title="Abrir original em nova aba"
            >
              ↗
            </a>
          )}
          <button
            className="delete-item-btn"
            onClick={(e) => {
              e.stopPropagation();
              onDeleteItem(item);
            }}
            title="Apagar este post"
          >
            🗑
          </button>
        </div>
      ))}
      {hasMore && (
        <button className="load-more" onClick={onLoadMore}>
          Carregar mais
        </button>
      )}
    </div>
  );
}
