import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { Tag } from '../types';
import './TagsPage.css';

interface TagsPageProps {
  onSelectTag: (tag: Tag) => void;
}

export function TagsPage({ onSelectTag }: TagsPageProps) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api.getTags().then((r) => setTags(r.tags));
  }

  useEffect(load, []);

  async function handleDelete(tag: Tag) {
    if (!window.confirm(`Excluir a tag "${tag.name}"? Os itens marcados com ela deixam de ter essa tag.`)) return;
    try {
      await api.deleteTag(tag.id);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao excluir tag.');
      setTimeout(() => setError(null), 4000);
    }
  }

  return (
    <div className="tags-page">
      <h2>Tags</h2>
      <p className="tags-hint">Tags são aplicadas automaticamente por regras (ação "Aplicar tag").</p>
      {error && <p className="tags-error">{error}</p>}
      {tags.length === 0 && <p className="tags-empty">Nenhuma tag ainda.</p>}
      <div className="tags-list">
        {tags.map((tag) => (
          <div key={tag.id} className="tag-row">
            <button className="tag-name-btn" onClick={() => onSelectTag(tag)}>
              #{tag.name}
            </button>
            <span className="tag-count">{tag.itemCount} itens</span>
            <button className="tag-delete-btn" onClick={() => handleDelete(tag)} title="Excluir tag">
              🗑
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
