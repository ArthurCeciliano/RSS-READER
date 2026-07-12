import type { ItemFilter, SortOrder, ViewMode } from '../types';
import './TopBar.css';

interface TopBarProps {
  scopeLabel: string;
  sort: SortOrder;
  onSortChange: (sort: SortOrder) => void;
  maxAgeDays: number | null;
  onMaxAgeChange: (days: number | null) => void;
  filter: ItemFilter;
  onFilterChange: (filter: ItemFilter) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onMarkAllRead: () => void;
  onRefresh: () => void;
  refreshing: boolean;
}

const VIEW_MODES: Array<{ mode: ViewMode; label: string; icon: string }> = [
  { mode: 'compact', label: 'Lista compacta', icon: '≡' },
  { mode: 'summary', label: 'Lista com resumo', icon: '☰' },
  { mode: 'cards', label: 'Cards em grade', icon: '▦' },
  { mode: 'three-pane', label: '3 painéis', icon: '⬛' },
];

export function TopBar({
  scopeLabel,
  sort,
  onSortChange,
  maxAgeDays,
  onMaxAgeChange,
  filter,
  onFilterChange,
  viewMode,
  onViewModeChange,
  onMarkAllRead,
  onRefresh,
  refreshing,
}: TopBarProps) {
  return (
    <header className="top-bar">
      <div className="top-bar-title">{scopeLabel}</div>

      <div className="top-bar-controls">
        <select value={filter} onChange={(e) => onFilterChange(e.target.value as ItemFilter)}>
          <option value="all">Todos</option>
          <option value="unread">Não lidos</option>
          <option value="starred">Estrelados</option>
        </select>

        <select value={sort} onChange={(e) => onSortChange(e.target.value as SortOrder)}>
          <option value="newest">Mais recentes</option>
          <option value="oldest">Mais antigos</option>
        </select>

        <select
          value={maxAgeDays ?? ''}
          onChange={(e) => onMaxAgeChange(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">Idade máxima: ilimitada</option>
          <option value="1">1 dia</option>
          <option value="7">7 dias</option>
          <option value="30">30 dias</option>
        </select>

        <div className="view-mode-switch">
          {VIEW_MODES.map((v) => (
            <button
              key={v.mode}
              className={viewMode === v.mode ? 'active' : ''}
              title={v.label}
              onClick={() => onViewModeChange(v.mode)}
            >
              {v.icon}
            </button>
          ))}
        </div>

        <button className="icon-btn" title="Marcar tudo como lido" onClick={onMarkAllRead}>
          ✓
        </button>
        <button className={`icon-btn ${refreshing ? 'spinning' : ''}`} title="Atualizar agora" onClick={onRefresh}>
          ⟳
        </button>
      </div>
    </header>
  );
}
