import type { FeedItem, ViewMode } from '../types';
import { relativeTime } from '../utils/relativeTime';
import './ItemList.css';

interface ItemListProps {
  items: FeedItem[];
  viewMode: ViewMode;
  onOpenItem: (item: FeedItem) => void;
  onToggleStar: (item: FeedItem) => void;
  onLoadMore: () => void;
  hasMore: boolean;
  selectedItemId?: string;
}

function ItemMeta({ item }: { item: FeedItem }) {
  return (
    <div className="item-meta">
      <span className="item-source">{item.source.title}</span>
      <span className="item-time">{relativeTime(item.publishedAt ?? item.createdAt)}</span>
    </div>
  );
}

export function ItemList({ items, viewMode, onOpenItem, onToggleStar, onLoadMore, hasMore, selectedItemId }: ItemListProps) {
  if (viewMode === 'cards') {
    return (
      <div className="item-grid">
        {items.map((item) => (
          <article
            key={item.id}
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
