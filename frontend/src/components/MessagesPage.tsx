import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { relativeTime } from '../utils/relativeTime';
import './MessagesPage.css';

interface DmPreview {
  id: string;
  senderName: string;
  previewText: string;
  avatarUrl: string | null;
  updatedAt?: string;
}

export function MessagesPage({ onChanged }: { onChanged: () => void }) {
  const [previews, setPreviews] = useState<DmPreview[]>([]);

  function load() {
    api.getPendingDmPreviews().then((r) => setPreviews(r.previews));
  }

  useEffect(load, []);

  async function openAndAck(preview: DmPreview) {
    window.open('https://www.instagram.com/direct/inbox/', '_blank');
    await api.ackDmPreview(preview.id);
    setPreviews((prev) => prev.filter((p) => p.id !== preview.id));
    onChanged();
  }

  return (
    <div className="messages-page">
      <p className="messages-hint">
        Prévias de mensagens do Instagram detectadas pela extensão — sem link direto pra conversa (só o Instagram tem
        isso), então clicar abre a caixa de entrada geral e marca como vista aqui.
      </p>
      {previews.length === 0 && <p className="messages-empty">Nenhuma mensagem nova no momento.</p>}
      <div className="messages-list">
        {previews.map((p) => (
          <button key={p.id} className="message-row" onClick={() => openAndAck(p)}>
            {p.avatarUrl && <img className="message-avatar" src={p.avatarUrl} alt="" />}
            <div className="message-body">
              <span className="message-sender">{p.senderName}</span>
              <span className="message-preview">{p.previewText}</span>
            </div>
            {p.updatedAt && <span className="message-time">{relativeTime(p.updatedAt)}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
