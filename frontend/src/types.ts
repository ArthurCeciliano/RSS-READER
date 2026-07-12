export type SourceType = 'rss' | 'atom' | 'json_feed' | 'youtube' | 'instagram' | 'tiktok' | 'reddit' | 'twitter';
export type SourceStatus = 'ok' | 'degraded' | 'failing';

export interface SourceSummary {
  id: string;
  title: string;
  type: SourceType;
  faviconUrl: string | null;
  status: SourceStatus;
  sortOrder: number;
  unreadCount: number;
}

export interface FolderNode {
  id: string;
  name: string;
  sortOrder: number;
  sources: SourceSummary[];
  unreadCount: number;
}

export interface ItemSourceRef {
  title: string;
  faviconUrl: string | null;
  siteUrl: string | null;
  type: SourceType;
}

export interface FeedItem {
  id: string;
  sourceId: string;
  guid: string | null;
  link: string | null;
  title: string;
  summary: string | null;
  contentHtml: string | null;
  imageUrl: string | null;
  author: string | null;
  publishedAt: string | null;
  isRead: boolean;
  isStarred: boolean;
  createdAt: string;
  source: ItemSourceRef;
}

export type ViewMode = 'compact' | 'summary' | 'cards' | 'three-pane';
export type SortOrder = 'newest' | 'oldest';
export type ItemFilter = 'all' | 'unread' | 'starred';

export interface SelectedScope {
  kind: 'all' | 'starred' | 'folder' | 'source';
  id?: string;
  label: string;
}

export interface ResolvedSourcePayload {
  kind: 'resolved';
  source: {
    type: SourceType;
    identityUrl: string;
    feedUrl: string | null;
    siteUrl?: string;
    title?: string;
  };
}

export interface ChoiceSourcePayload {
  kind: 'choice';
  siteUrl: string;
  candidates: Array<{ title: string; feedUrl: string }>;
}

export interface UnresolvedSourcePayload {
  kind: 'unresolved';
  reason: string;
}

export type ResolveSourceResponse = ResolvedSourcePayload | ChoiceSourcePayload | UnresolvedSourcePayload;

export interface SourceHealth {
  id: string;
  title: string;
  type: SourceType;
  status: SourceStatus;
  lastSuccessAt: string | null;
  lastFetchedAt: string | null;
  nextFetchAt: string | null;
  consecutiveFails: number;
  lastError: string | null;
}
