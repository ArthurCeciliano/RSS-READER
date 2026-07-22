import type {
  FeedItem,
  FolderNode,
  InstagramRiskStats,
  ItemFilter,
  ResolvedSourcePayload,
  ResolveSourceResponse,
  Rule,
  RuleActionSpec,
  RuleCondition,
  SortOrder,
  SourceHealth,
  Tag,
} from '../types';

// In dev (separate Vite server) default to the local backend port; in a production
// build (combined deploy, e.g. Render) default to relative paths since the backend
// serves the frontend from the same origin. VITE_API_URL still overrides both.
const BASE_URL = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:3001' : '');

// Surfaced in Settings so the user can paste the reachable API URL into the
// browser extension's Options page (extension/) — it runs standalone, outside
// this app's own origin, so it can't infer the URL any other way.
export const API_BASE_URL = BASE_URL || (typeof window !== 'undefined' ? window.location.origin : '');

export class ApiError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Only send Content-Type when there's actually a body -- Fastify's JSON body
  // parser rejects an empty body sent with application/json (e.g. a plain
  // POST /refresh or DELETE with no payload) with a 400.
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string> | undefined) };
  if (init?.body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  if (!res.ok && res.status !== 202 && res.status !== 422) {
    let message = `${init?.method ?? 'GET'} ${path} failed: ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // response wasn't JSON — keep the generic message
    }
    throw new ApiError(message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  getFolders: () => request<{ folders: FolderNode[] }>('/api/folders'),

  createFolder: (name: string, parentId?: string | null) =>
    request('/api/folders', { method: 'POST', body: JSON.stringify({ name, parentId }) }),

  updateFolder: (id: string, patch: { name?: string; sortOrder?: number; parentId?: string | null }) =>
    request(`/api/folders/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  deleteFolder: (id: string) => request(`/api/folders/${id}`, { method: 'DELETE' }),

  updateSource: (
    id: string,
    patch: { title?: string; folderId?: string | null; sortOrder?: number; storyAcknowledged?: boolean },
  ) => request(`/api/sources/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  deleteSource: (id: string) => request(`/api/sources/${id}`, { method: 'DELETE' }),

  getItems: (params: {
    folderId?: string;
    sourceId?: string;
    tagId?: string;
    filter?: ItemFilter;
    sort?: SortOrder;
    maxAgeDays?: number;
    cursor?: string;
  }) => {
    const search = new URLSearchParams();
    if (params.folderId) search.set('folderId', params.folderId);
    if (params.sourceId) search.set('sourceId', params.sourceId);
    if (params.tagId) search.set('tagId', params.tagId);
    if (params.filter) search.set('filter', params.filter);
    if (params.sort) search.set('sort', params.sort);
    if (params.maxAgeDays) search.set('maxAgeDays', String(params.maxAgeDays));
    if (params.cursor) search.set('cursor', params.cursor);
    return request<{ items: FeedItem[]; nextCursor: string | null }>(`/api/items?${search.toString()}`);
  },

  searchItems: (q: string) => request<{ items: FeedItem[] }>(`/api/items/search?q=${encodeURIComponent(q)}`),

  updateItem: (id: string, patch: { isRead?: boolean; isStarred?: boolean }) =>
    request(`/api/items/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  markAllRead: (scope: { folderId?: string; sourceId?: string }) =>
    request('/api/items/mark-all-read', { method: 'POST', body: JSON.stringify(scope) }),

  resolveSource: (url: string) =>
    request<ResolveSourceResponse>('/api/sources/resolve', { method: 'POST', body: JSON.stringify({ url }) }),

  createSource: (payload: {
    url?: string;
    resolved?: ResolvedSourcePayload['source'];
    folderId?: string | null;
    title?: string;
  }) => request('/api/sources', { method: 'POST', body: JSON.stringify(payload) }),

  refreshSource: (id: string) => request(`/api/sources/${id}/refresh`, { method: 'POST' }),

  refreshAll: (folderId?: string) =>
    request('/api/sources/refresh-all', { method: 'POST', body: JSON.stringify({ folderId }) }),

  getSourceHealth: () => request<{ sources: SourceHealth[] }>('/api/sources/health'),

  importOpml: async (file: File, skipExisting: boolean) => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${BASE_URL}/api/opml/import?skipExisting=${skipExisting}`, { method: 'POST', body: form });
    const body = await res.json();
    if (!res.ok) throw new ApiError(body?.error ?? `import failed: ${res.status}`);
    return body as { jobId: string };
  },

  getImportJob: (jobId: string) =>
    request<{ status: string; processed: number; total: number; report?: unknown; error?: string }>(
      `/api/opml/import/${jobId}`,
    ),

  exportOpmlUrl: () => `${BASE_URL}/api/opml/export`,

  getSettings: () => request<Record<string, unknown>>('/api/settings'),

  updateSettings: (patch: Record<string, unknown>) =>
    request('/api/settings', { method: 'PUT', body: JSON.stringify(patch) }),

  getExtensionToken: () => request<{ token: string }>('/api/settings/extension-token'),

  regenerateExtensionToken: () =>
    request<{ token: string }>('/api/settings/extension-token/regenerate', { method: 'POST' }),

  getStats: (days = 30) =>
    request<{
      days: number;
      itemsPerDay: Array<{ date: string; count: number }>;
      topSources: Array<{ sourceId: string; title: string; count: number }>;
      readRate: { read: number; unread: number; total: number };
      starredCount: number;
      sourceCount: number;
      folderCount: number;
    }>(`/api/stats?days=${days}`),

  getInstagramStats: () => request<InstagramRiskStats>('/api/stats/instagram'),

  getRules: () => request<{ rules: Rule[] }>('/api/rules'),

  createRule: (rule: { name: string; enabled?: boolean; conditions: RuleCondition[]; actions: RuleActionSpec[] }) =>
    request('/api/rules', { method: 'POST', body: JSON.stringify(rule) }),

  updateRule: (
    id: string,
    patch: Partial<{ name: string; enabled: boolean; conditions: RuleCondition[]; actions: RuleActionSpec[] }>,
  ) => request(`/api/rules/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  deleteRule: (id: string) => request(`/api/rules/${id}`, { method: 'DELETE' }),

  getTags: () => request<{ tags: Tag[] }>('/api/tags'),

  deleteTag: (id: string) => request(`/api/tags/${id}`, { method: 'DELETE' }),

  getPendingNotifications: () =>
    request<{
      items: Array<{ id: string; title: string; pendingDesktopNotify: boolean; pendingSound: boolean; source: { title: string } }>;
    }>('/api/items/pending-notifications'),

  ackNotification: (id: string) => request(`/api/items/${id}/ack-notification`, { method: 'POST' }),

  getPendingDmPreviews: () =>
    request<{ previews: Array<{ id: string; senderName: string; previewText: string; avatarUrl: string | null }> }>(
      '/api/dm-previews/pending',
    ),

  ackDmPreview: (id: string) => request(`/api/dm-previews/${id}/ack`, { method: 'POST' }),

  ackAllDmPreviews: () => request<{ updated: number }>('/api/dm-previews/ack-all', { method: 'POST' }),
};
