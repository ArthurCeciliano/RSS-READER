import DOMPurify from 'dompurify';
import type { FeedItem } from '../types';
import { relativeTime } from '../utils/relativeTime';
import { buildYouTubeEmbedUrl, extractYouTubeVideoId } from '../utils/youtube';
import './Reader.css';

interface ReaderProps {
  item: FeedItem;
  onClose: () => void;
  onToggleStar: (item: FeedItem) => void;
  onNext: () => void;
  onPrev: () => void;
}

export function Reader({ item, onClose, onToggleStar, onNext, onPrev }: ReaderProps) {
  const html = item.contentHtml ?? item.summary ?? '';
  const clean = DOMPurify.sanitize(html, {
    FORBID_TAGS: ['script', 'object', 'applet', 'iframe', 'embed'],
  });
  const youtubeVideoId = item.source.type === 'youtube' ? extractYouTubeVideoId(item.link) : null;

  return (
    <div className="reader-overlay" onClick={onClose}>
      <div className="reader-panel" onClick={(e) => e.stopPropagation()}>
        <div className="reader-toolbar">
          <button onClick={onPrev} title="Anterior (k)">
            ↑
          </button>
          <button onClick={onNext} title="Próximo (j)">
            ↓
          </button>
          <button className={item.isStarred ? 'starred' : ''} onClick={() => onToggleStar(item)} title="Estrela (s)">
            ★
          </button>
          {item.link && (
            <a href={item.link} target="_blank" rel="noreferrer" title="Abrir original (v)">
              ↗ Abrir original
            </a>
          )}
          <button className="reader-close" onClick={onClose} title="Fechar">
            ✕
          </button>
        </div>

        <div className="reader-article">
          <h1>{item.title}</h1>
          <div className="reader-meta">
            <span>{item.source.title}</span>
            {item.author && <span> · {item.author}</span>}
            <span> · {relativeTime(item.publishedAt ?? item.createdAt)}</span>
          </div>
          {youtubeVideoId ? (
            <div className="reader-video-embed">
              <iframe
                src={buildYouTubeEmbedUrl(youtubeVideoId)}
                title={item.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          ) : (
            item.imageUrl && <img className="reader-hero-image" src={item.imageUrl} alt="" />
          )}
          <div className="reader-body" dangerouslySetInnerHTML={{ __html: clean }} />
        </div>
      </div>
    </div>
  );
}
