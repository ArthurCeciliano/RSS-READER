import { useEffect, useRef, useState } from 'react';
import { api, ApiError, API_BASE_URL } from '../api/client';
import './SettingsPage.css';

type Settings = Record<string, unknown>;

export function SettingsPage() {
  const [settings, setSettings] = useState<Settings>({});
  const [dirty, setDirty] = useState<Settings>({});
  const [importStatus, setImportStatus] = useState<{
    processed: number;
    total: number;
    done: boolean;
    error?: string;
  } | null>(null);
  const [skipExisting, setSkipExisting] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [extensionToken, setExtensionToken] = useState<string | null>(null);
  const [extensionIdSaved, setExtensionIdSaved] = useState(false);

  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => setSettings({}));
  }, []);

  useEffect(() => {
    api.getExtensionToken().then((r) => setExtensionToken(r.token)).catch(() => {});
  }, []);

  async function regenerateExtensionToken() {
    if (!confirm('Isso invalida o token usado pela extensão já instalada — ela vai parar de sincronizar até você colar o novo token nas Opções dela. Continuar?')) {
      return;
    }
    const { token } = await api.regenerateExtensionToken();
    setExtensionToken(token);
  }

  async function saveExtensionId() {
    await api.updateSettings({ instagramExtensionId: settings.instagramExtensionId ?? '' });
    setExtensionIdSaved(true);
    setTimeout(() => setExtensionIdSaved(false), 2000);
  }

  function set(key: string, value: unknown) {
    setSettings((s) => ({ ...s, [key]: value }));
    setDirty((d) => ({ ...d, [key]: value }));
  }

  async function save() {
    if (Object.keys(dirty).length === 0) return;
    await api.updateSettings(dirty);
    setDirty({});
  }

  async function handleImportFile(file: File) {
    setImportStatus({ processed: 0, total: 0, done: false });
    let jobId: string;
    try {
      ({ jobId } = await api.importOpml(file, skipExisting));
    } catch (err) {
      setImportStatus({ processed: 0, total: 0, done: true, error: err instanceof ApiError ? err.message : 'Falha ao enviar o arquivo.' });
      return;
    }
    const poll = setInterval(async () => {
      try {
        const job = await api.getImportJob(jobId);
        setImportStatus({ processed: job.processed, total: job.total, done: job.status !== 'running', error: job.error });
        if (job.status !== 'running') clearInterval(poll);
      } catch (err) {
        setImportStatus({ processed: 0, total: 0, done: true, error: err instanceof ApiError ? err.message : 'Falha ao consultar o progresso.' });
        clearInterval(poll);
      }
    }, 500);
  }

  const val = (key: string, fallback: unknown) => settings[key] ?? fallback;

  return (
    <div className="settings-page">
      <section className="settings-section">
        <h2>Feed Subscriptions &amp; Rules</h2>
        <div className="settings-grid-actions">
          <div className="settings-block">
            <span className="settings-block-label">Feeds</span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".opml,.xml"
              style={{ display: 'none' }}
              onChange={(e) => e.target.files?.[0] && handleImportFile(e.target.files[0])}
            />
            <button onClick={() => fileInputRef.current?.click()}>Import Feed Subscriptions (as OPML)</button>
            <a className="btn-like" href={api.exportOpmlUrl()}>
              Export Feed Subscriptions (as OPML)
            </a>
            <label className="inline-check">
              <input type="checkbox" checked={skipExisting} onChange={(e) => setSkipExisting(e.target.checked)} />
              Skip existing OPML entries
            </label>
            {importStatus && (
              <div className="import-progress">
                <div className="import-progress-bar">
                  <div
                    className="import-progress-fill"
                    style={{ width: importStatus.total ? `${(importStatus.processed / importStatus.total) * 100}%` : '0%' }}
                  />
                </div>
                <span>
                  {importStatus.processed}/{importStatus.total} {importStatus.done && !importStatus.error ? '— concluído' : ''}
                </span>
                {importStatus.error && <p className="settings-error">Erro: {importStatus.error}</p>}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="settings-section">
        <h2>Extensão do navegador — Instagram</h2>
        <div className="settings-grid-actions">
          <div className="settings-block">
            <span className="settings-block-label">URL da API (cole nas Opções da extensão)</span>
            <input type="text" readOnly value={API_BASE_URL} onFocus={(e) => e.target.select()} style={{ width: '100%' }} />
          </div>
          <div className="settings-block">
            <span className="settings-block-label">Token (cole nas Opções da extensão)</span>
            <input type="text" readOnly value={extensionToken ?? '…'} onFocus={(e) => e.target.select()} style={{ width: '100%' }} />
            <button onClick={regenerateExtensionToken}>Gerar novo token</button>
          </div>
          <div className="settings-block">
            <span className="settings-block-label">ID da extensão (chrome://extensions → card da extensão → campo "ID")</span>
            <input
              type="text"
              value={val('instagramExtensionId', '') as string}
              onChange={(e) => set('instagramExtensionId', e.target.value)}
              style={{ width: '100%' }}
            />
            <button onClick={saveExtensionId}>Salvar ID</button>
            {extensionIdSaved && <span style={{ color: 'var(--accent)', fontSize: 12.5 }}>Salvo!</span>}
          </div>
          <p className="settings-error" style={{ color: 'var(--text-secondary)' }}>
            Instale a extensão "RSS Reader - Instagram Bridge", abra as Opções dela e cole a URL e o token acima. Ela vai
            buscar os perfis do Instagram usando sua sessão logada no navegador e enviar pra cá — só funciona enquanto o
            navegador está aberto. Com o ID da extensão salvo aqui, os botões "⟳" que aparecem ao passar o mouse sobre um
            perfil de Instagram ou sobre uma pasta com perfis (na barra lateral) disparam a sincronização daquele perfil
            ou pasta. Não há mais atualização automática — o Instagram só é lido quando você pede.
          </p>
        </div>
      </section>

      <section className="settings-section">
        <h2>Settings</h2>
        <div className="settings-form">
          <label>Theme</label>
          <select value={val('theme', 'dark') as string} onChange={(e) => set('theme', e.target.value)}>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>

          <label>Feed loading timeout</label>
          <input
            type="number"
            value={val('feedLoadTimeoutSeconds', 25) as number}
            onChange={(e) => set('feedLoadTimeoutSeconds', Number(e.target.value))}
          />

          <label>Scan interval (default)</label>
          <input
            type="number"
            value={val('defaultScanIntervalMinutes', 30) as number}
            onChange={(e) => set('defaultScanIntervalMinutes', Number(e.target.value))}
          />

          <label>Feed update threads</label>
          <input
            type="number"
            value={val('feedUpdateThreads', 4) as number}
            onChange={(e) => set('feedUpdateThreads', Number(e.target.value))}
          />

          <label>Maximum entries to save (default)</label>
          <input
            type="number"
            value={val('defaultMaxEntries', 20) as number}
            onChange={(e) => set('defaultMaxEntries', Number(e.target.value))}
          />

          <label>Inactive feed limit (days)</label>
          <input
            type="number"
            value={val('inactiveFeedLimitDays', 180) as number}
            onChange={(e) => set('inactiveFeedLimitDays', Number(e.target.value))}
          />

          <label>Article title font size (%)</label>
          <input
            type="number"
            value={val('articleTitleFontSize', 100) as number}
            onChange={(e) => set('articleTitleFontSize', Number(e.target.value))}
          />

          <label>Article body font size (%)</label>
          <input
            type="number"
            value={val('articleBodyFontSize', 110) as number}
            onChange={(e) => set('articleBodyFontSize', Number(e.target.value))}
          />

          <label>Article body line height</label>
          <input
            type="number"
            step="0.05"
            value={val('articleBodyLineHeight', 1.45) as number}
            onChange={(e) => set('articleBodyLineHeight', Number(e.target.value))}
          />

          <label>Mark article as read</label>
          <select value={val('markArticleAsRead', 'on_display') as string} onChange={(e) => set('markArticleAsRead', e.target.value)}>
            <option value="on_display">Automatically when displayed</option>
            <option value="on_click">Only when clicked</option>
            <option value="manual">Manually</option>
          </select>

          <label>Favicon provider</label>
          <select value={val('faviconProvider', 'google') as string} onChange={(e) => set('faviconProvider', e.target.value)}>
            <option value="google">Google</option>
            <option value="duckduckgo">DuckDuckGo</option>
            <option value="none">None</option>
          </select>

          <label>Use favicons in navigator</label>
          <input
            type="checkbox"
            checked={val('useFaviconsInNavigator', true) as boolean}
            onChange={(e) => set('useFaviconsInNavigator', e.target.checked)}
          />

          <label>Truncate long titles</label>
          <input
            type="checkbox"
            checked={val('truncateLongTitles', true) as boolean}
            onChange={(e) => set('truncateLongTitles', e.target.checked)}
          />

          <label>MathJax enabled</label>
          <input
            type="checkbox"
            checked={val('mathJaxEnabled', false) as boolean}
            onChange={(e) => set('mathJaxEnabled', e.target.checked)}
          />

          <label>Justify text in articles</label>
          <input
            type="checkbox"
            checked={val('justifyText', false) as boolean}
            onChange={(e) => set('justifyText', e.target.checked)}
          />

          <label>Disable automatic feed scanning</label>
          <input
            type="checkbox"
            checked={val('disableAutomaticFeedScanning', false) as boolean}
            onChange={(e) => set('disableAutomaticFeedScanning', e.target.checked)}
          />
        </div>

        <button className="save-btn" onClick={save} disabled={Object.keys(dirty).length === 0}>
          Salvar configurações
        </button>
      </section>
    </div>
  );
}
