import { useEffect, useState } from 'react';
import { api } from '../api/client';
import './StatsPage.css';

interface StatsData {
  days: number;
  itemsPerDay: Array<{ date: string; count: number }>;
  topSources: Array<{ sourceId: string; title: string; count: number }>;
  readRate: { read: number; unread: number; total: number };
  starredCount: number;
  sourceCount: number;
  folderCount: number;
}

function formatDayLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function StatTile({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="stat-tile">
      <span className="stat-tile-value">{value}</span>
      <span className="stat-tile-label">{label}</span>
    </div>
  );
}

function ItemsPerDayChart({ data }: { data: StatsData['itemsPerDay'] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  // Show at most ~30 bars worth of labels without crowding; label every Nth tick.
  const labelEvery = Math.max(1, Math.ceil(data.length / 10));

  return (
    <div className="chart-card">
      <h3>Itens por dia</h3>
      <div className="bar-chart" role="img" aria-label="Itens ingeridos por dia">
        {data.map((d, i) => (
          <div className="bar-col" key={d.date}>
            <div className="bar-col-track">
              <div
                className="bar-col-fill"
                style={{ height: `${(d.count / max) * 100}%` }}
                title={`${d.date}: ${d.count} ${d.count === 1 ? 'item' : 'itens'}`}
              />
            </div>
            {i % labelEvery === 0 && <span className="bar-col-label">{formatDayLabel(d.date)}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function TopSourcesChart({ data }: { data: StatsData['topSources'] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="chart-card">
      <h3>Fontes mais ativas</h3>
      {data.length === 0 && <p className="chart-empty">Sem dados no período.</p>}
      <div className="hbar-chart">
        {data.map((s) => (
          <div className="hbar-row" key={s.sourceId}>
            <span className="hbar-label" title={s.title}>
              {s.title}
            </span>
            <div className="hbar-track">
              <div className="hbar-fill" style={{ width: `${(s.count / max) * 100}%` }} />
            </div>
            <span className="hbar-value">{s.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReadRateMeter({ readRate }: { readRate: StatsData['readRate'] }) {
  const pct = readRate.total > 0 ? Math.round((readRate.read / readRate.total) * 100) : 0;
  return (
    <div className="chart-card">
      <h3>Taxa de leitura</h3>
      <div className="meter">
        <div className="meter-track">
          <div className="meter-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="meter-value">{pct}%</span>
      </div>
      <p className="chart-hint">
        {readRate.read} lidos de {readRate.total} ({readRate.unread} não lidos)
      </p>
    </div>
  );
}

export function StatsPage() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [days, setDays] = useState(30);

  useEffect(() => {
    api.getStats(days).then(setStats).catch(() => setStats(null));
  }, [days]);

  if (!stats) return <div className="stats-page">Carregando...</div>;

  return (
    <div className="stats-page">
      <div className="stats-header">
        <h2>Estatísticas</h2>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>Últimos 7 dias</option>
          <option value={30}>Últimos 30 dias</option>
          <option value={90}>Últimos 90 dias</option>
        </select>
      </div>

      <div className="stat-tiles">
        <StatTile label="Itens totais" value={stats.readRate.total} />
        <StatTile label="Estrelados" value={stats.starredCount} />
        <StatTile label="Fontes" value={stats.sourceCount} />
        <StatTile label="Pastas" value={stats.folderCount} />
      </div>

      <ItemsPerDayChart data={stats.itemsPerDay} />

      <div className="stats-grid-2">
        <TopSourcesChart data={stats.topSources} />
        <ReadRateMeter readRate={stats.readRate} />
      </div>
    </div>
  );
}
