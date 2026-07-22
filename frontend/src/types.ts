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
  identityUrl: string;
  hasActiveStory: boolean;
  storyAcknowledged: boolean;
}

export interface FolderNode {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  sources: SourceSummary[];
  children: FolderNode[];
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
  kind: 'all' | 'starred' | 'folder' | 'source' | 'tag';
  id?: string;
  label: string;
}

export type RuleField = 'source' | 'folder' | 'title' | 'content';
export type RuleActionType = 'mark_read' | 'star' | 'apply_tag' | 'notify_desktop' | 'play_sound';

export interface RuleCondition {
  field: RuleField;
  value: string;
}

export interface RuleActionSpec {
  type: RuleActionType;
  tagName?: string;
}

export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  conditions: RuleCondition[];
  actions: RuleActionSpec[];
  sortOrder: number;
}

export interface Tag {
  id: string;
  name: string;
  itemCount: number;
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

export type RiskLevel = 'safe' | 'attention' | 'risk';
export type FolderSignal = 'ok' | 'high' | 'problem';

export interface InstagramRiskStats {
  hasData: boolean;
  updatedAt: string | null;
  today: { reads: number; ok: number; empty: number; blocked: number };
  blocks48h: number;
  risk: { level: RiskLevel; label: string; reason: string };
  daily: Array<{ date: string; reads: number; blocked: number; empty: number }>;
  folders: Array<{
    folderId: string;
    name: string;
    profiles: number;
    reads7d: number;
    empty7d: number;
    blocked7d: number;
    signal: FolderSignal;
    note: string;
  }>;
  thresholds: { safePerDay: number; attentionPerDay: number };
}
