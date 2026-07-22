import type { FolderNode } from '../types';
import { flattenFolders, collectDescendantIds } from '../folderTree';
import './Dialog.css';

interface MoveFolderDialogProps {
  folders: FolderNode[];
  folder: FolderNode;
  onClose: () => void;
  onPick: (parentId: string | null) => void;
}

export function MoveFolderDialog({ folders, folder, onClose, onPick }: MoveFolderDialogProps) {
  // A folder can't become its own parent, nor a descendant of itself.
  const excluded = collectDescendantIds(folder);
  const options = flattenFolders(folders).filter((f) => !excluded.has(f.id));

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Mover pasta "{folder.name}"</h2>
        <p className="dialog-hint">Escolha a nova pasta pai.</p>
        <div className="dialog-choice">
          <button className="choice-item" onClick={() => onPick(null)}>
            (nível superior — sem pasta pai)
          </button>
          {options.map((f) => (
            <button
              key={f.id}
              className="choice-item"
              style={{ paddingLeft: 12 + f.depth * 16 }}
              onClick={() => onPick(f.id)}
            >
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
