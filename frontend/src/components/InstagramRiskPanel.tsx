import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { InstagramRiskStats } from '../types';

function formatDayLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

const SIGNAL_LABEL: Record<InstagramRiskStats['folders'][number]['signal'], string> = {
  ok: 'OK',
  high: 'Volume alto',
  problem: 'Problema',
};

function RiskBadge({ risk }: { risk: InstagramRiskStats['risk'] }) {
  return (
    <div className={`risk-badge risk-${risk.level}`}>
      <span className="risk-badge-dot" />
      <div>
        <div className="risk-badge-label">{risk.label}</div>
        <div className="risk-badge-reason">{risk.reason}</div>
      </div>
    </div>
  );
}

function DailyReadsChart({ daily }: { daily: InstagramRiskStats['daily'] }) {
  const max = Math.max(1, ...daily.map((d) => d.reads));
  return (
    <div className="chart-card">
      <h3>Leituras de perfil por dia (últimos 14 dias)</h3>
      <div className="bar-chart" role="img" aria-label="Leituras de perfil por dia">
        {daily.map((d) => (
          <div className="bar-col" key={d.date}>
            <div className="bar-col-track">
              <div
                className={`bar-col-fill${d.blocked > 0 ? ' bar-col-fill--blocked' : ''}`}
                style={{ height: `${(d.reads / max) * 100}%` }}
                title={`${d.date}: ${d.reads} leituras${d.blocked > 0 ? ` · ${d.blocked} bloqueio(s)` : ''}${
                  d.empty > 0 ? ` · ${d.empty} vazio(s)` : ''
                }`}
              />
            </div>
            <span className="bar-col-label">{formatDayLabel(d.date)}</span>
          </div>
        ))}
      </div>
      <p className="chart-hint">Barras em vermelho = dias com bloqueio (sinal de que passou do limite).</p>
    </div>
  );
}

const REFERENCE_ROWS = [
  { zone: 'safe', label: '🟢 Seguro', perHour: 'até ~20–25', perDay: 'até ~150', gap: '≥ 30s' },
  { zone: 'attention', label: '🟡 Atenção', perHour: '~25–50', perDay: '~150–350', gap: '10–30s' },
  { zone: 'risk', label: '🔴 Risco', perHour: '> 50–60', perDay: '> 350', gap: '< 10s / rajada' },
] as const;

export function InstagramRiskPanel() {
  const [stats, setStats] = useState<InstagramRiskStats | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.getInstagramStats().then(setStats).catch(() => setError(true));
  }, []);

  if (error) return null;
  if (!stats) return <div className="chart-card">Carregando risco…</div>;

  return (
    <div className="ig-risk">
      <h2 className="ig-risk-title">Risco de limitação — Instagram</h2>

      <RiskBadge risk={stats.risk} />

      <div className="stat-tiles">
        <div className="stat-tile">
          <span className="stat-tile-value">{stats.today.reads}</span>
          <span className="stat-tile-label">Leituras hoje</span>
        </div>
        <div className="stat-tile">
          <span className={`stat-tile-value${stats.blocks48h > 0 ? ' stat-danger' : ''}`}>{stats.blocks48h}</span>
          <span className="stat-tile-label">Bloqueios (48h)</span>
        </div>
        <div className="stat-tile">
          <span className="stat-tile-value">{stats.today.empty}</span>
          <span className="stat-tile-label">Vazios hoje</span>
        </div>
        <div className="stat-tile">
          <span className="stat-tile-value">{stats.today.ok}</span>
          <span className="stat-tile-label">OK hoje</span>
        </div>
      </div>

      {!stats.hasData && (
        <p className="chart-hint">
          Ainda sem leituras registradas. Assim que a extensão sincronizar as pastas, os números aparecem aqui.
        </p>
      )}

      <DailyReadsChart daily={stats.daily} />

      <div className="chart-card">
        <h3>Por pasta (últimos 7 dias)</h3>
        <table className="ig-folder-table">
          <thead>
            <tr>
              <th>Pasta</th>
              <th>Perfis</th>
              <th>Leituras</th>
              <th>Vazios</th>
              <th>Bloq.</th>
              <th>Sinal</th>
            </tr>
          </thead>
          <tbody>
            {stats.folders.map((f) => (
              <tr key={f.folderId}>
                <td className="ig-folder-name" title={f.note}>
                  {f.name}
                </td>
                <td>{f.profiles}</td>
                <td>{f.reads7d}</td>
                <td>{f.empty7d}</td>
                <td className={f.blocked7d > 0 ? 'stat-danger' : ''}>{f.blocked7d}</td>
                <td>
                  <span className={`signal-chip signal-${f.signal}`} title={f.note}>
                    {SIGNAL_LABEL[f.signal]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="chart-hint">
          Passe o mouse no sinal para ver o motivo. "Volume alto" = pasta grande ou muitos perfis sem posts — candidatos
          a dividir ou deixar de seguir.
        </p>
      </div>

      <div className="chart-card">
        <h3>Referência de risco (estimativa)</h3>
        <table className="risk-ref-table">
          <thead>
            <tr>
              <th>Zona</th>
              <th>Perfis/hora (pico)</th>
              <th>Perfis/dia</th>
              <th>Espaçamento</th>
            </tr>
          </thead>
          <tbody>
            {REFERENCE_ROWS.map((r) => (
              <tr key={r.zone}>
                <td>{r.label}</td>
                <td>{r.perHour}</td>
                <td>{r.perDay}</td>
                <td>{r.gap}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="chart-hint">
          Números estimados (o Instagram não os publica). Bloqueios são o sinal mais confiável de que passou do limite.
        </p>
      </div>
    </div>
  );
}
