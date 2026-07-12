import type { FolderNode } from '../types';
import './Dialog.css';

interface MoveToFolderDialogProps {
  folders: FolderNode[];
  sourceTitle: string;
  onClose: () => void;
  onPick: (folderId: string | null) => void;
}

export function MoveToFolderDialog({ folders, sourceTitle, onClose, onPick }: MoveToFolderDialogProps) {
  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Mover "{sourceTitle}"</h2>
        <p className="dialog-hint">Escolha a pasta de destino.</p>
        <div className="dialog-choice">
          <button className="choice-item" onClick={() => onPick(null)}>
            (sem pasta)
          </button>
          {folders.map((f) => (
            <button key={f.id} className="choice-item" onClick={() => onPick(f.id)}>
              {f.name}
            </button>
          ))}
        </div>
        <div className="dialog-actions">
          <button onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
