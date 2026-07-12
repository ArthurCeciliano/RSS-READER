import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
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

  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => setSettings({}));
  }, []);

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
