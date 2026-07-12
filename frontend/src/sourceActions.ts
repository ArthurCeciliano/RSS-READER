import { api } from './api/client';

/** Shared rename/delete flows (prompt/confirm-based) reused by the sidebar and the feed health page. */

export async function renameSourcePrompt(id: string, currentTitle: string): Promise<boolean> {
  const title = window.prompt('Renomear fonte:', currentTitle);
  if (!title?.trim() || title.trim() === currentTitle) return false;
  await api.updateSource(id, { title: title.trim() });
  return true;
}

export async function deleteSourceConfirm(id: string, title: string): Promise<boolean> {
  if (!window.confirm(`Excluir a fonte "${title}"? Os itens já lidos/estrelados também são apagados.`)) return false;
  await api.deleteSource(id);
  return true;
}
