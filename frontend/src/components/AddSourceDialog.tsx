import { useState } from 'react';
import { api } from '../api/client';
import type { FolderNode, ResolveSourceResponse } from '../types';
import './Dialog.css';

interface AddSourceDialogProps {
  folders: FolderNode[];
  onClose: () => void;
  onAdded: () => void;
}

export function AddSourceDialog({ folders, onClose, onAdded }: AddSourceDialogProps) {
  const [url, setUrl] = useState('');
  const [folderId, setFolderId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ResolveSourceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleResolve() {
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.resolveSource(url.trim());
      setResult(res);
    } catch {
      setError('Não foi possível resolver essa URL. Verifique sua conexão com o backend.');
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm(feedUrl?: string) {
    setLoading(true);
    setError(null);
    try {
      await api.createSource({ url: feedUrl ?? url.trim(), folderId: folderId || null });
      onAdded();
      onClose();
    } catch {
      setError('Falha ao adicionar a fonte.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Adicionar fonte</h2>
        <p className="dialog-hint">
          Cole a URL de um site, feed RSS/Atom, canal do YouTube, perfil do Instagram, TikTok ou subreddit.
        </p>
        <div className="dialog-row">
          <input
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleResolve()}
            placeholder="https://..."
          />
          <button onClick={handleResolve} disabled={loading}>
            {loading ? '...' : 'Resolver'}
          </button>
        </div>

        <div className="dialog-row">
          <label>Pasta</label>
          <select value={folderId} onChange={(e) => setFolderId(e.target.value)}>
            <option value="">(sem pasta)</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>

        {error && <p className="dialog-error">{error}</p>}

        {result?.kind === 'resolved' && (
          <div className="dialog-resolved">
            <p>
              Tipo: <strong>{result.source.type}</strong>
              {result.source.title && <> — {result.source.title}</>}
            </p>
            <button className="primary" onClick={() => handleConfirm()} disabled={loading}>
              Adicionar
            </button>
          </div>
        )}

        {result?.kind === 'choice' && (
          <div className="dialog-choice">
            <p>Múltiplos feeds encontrados, escolha um:</p>
            {result.candidates.map((c) => (
              <button key={c.feedUrl} className="choice-item" onClick={() => handleConfirm(c.feedUrl)}>
                {c.title}
              </button>
            ))}
          </div>
        )}

        {result?.kind === 'unresolved' && <p className="dialog-error">Nenhum feed encontrado ({result.reason}).</p>}

        <div className="dialog-actions">
          <button onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
