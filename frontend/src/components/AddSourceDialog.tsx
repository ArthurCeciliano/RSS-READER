import { useState } from 'react';
import { api, ApiError } from '../api/client';
import { flattenFolders } from '../folderTree';
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
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível resolver essa URL. Verifique sua conexão com o backend.');
    } finally {
      setLoading(false);
    }
  }

  // Reuses the already-resolved source (from handleResolve) instead of asking the
  // backend to re-resolve the raw URL — re-resolving a YouTube handle or bridge
  // profile means another live network fetch that can transiently fail even
  // though the first resolution just succeeded.
  async function handleConfirmResolved() {
    if (result?.kind !== 'resolved') return;
    setLoading(true);
    setError(null);
    try {
      await api.createSource({ resolved: result.source, folderId: folderId || null });
      onAdded();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao adicionar a fonte.');
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirmCandidate(feedUrl: string) {
    setLoading(true);
    setError(null);
    try {
      await api.createSource({ url: feedUrl, folderId: folderId || null });
      onAdded();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao adicionar a fonte.');
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
            {flattenFolders(folders).map((f) => (
              <option key={f.id} value={f.id}>
                {'—'.repeat(f.depth)} {f.name}
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
            <button className="primary" onClick={handleConfirmResolved} disabled={loading}>
              Adicionar
            </button>
          </div>
        )}

        {result?.kind === 'choice' && (
          <div className="dialog-choice">
            <p>Múltiplos feeds encontrados, escolha um:</p>
            {result.candidates.map((c) => (
              <button key={c.feedUrl} className="choice-item" onClick={() => handleConfirmCandidate(c.feedUrl)}>
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
