import { useEffect, useRef } from 'react';
import './ContextMenu.css';

export interface ContextMenuAction {
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  actions: ContextMenuAction[];
  onClose: () => void;
}

export function ContextMenu({ x, y, actions, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  return (
    <div className="context-menu" style={{ left: x, top: y }} ref={ref}>
      {actions.map((action) => (
        <button
          key={action.label}
          className={`context-menu-item ${action.danger ? 'danger' : ''}`}
          onClick={() => {
            action.onSelect();
            onClose();
          }}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
