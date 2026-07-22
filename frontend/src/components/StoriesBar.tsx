import type { FolderNode, SelectedScope } from '../types';
import { flattenFolderNodes, collectAllSources } from '../folderTree';
import './StoriesBar.css';

function extractInstagramUsername(identityUrl: string): string {
  try {
    return new URL(identityUrl).pathname.replace(/^\/|\/$/g, '');
  } catch {
    return identityUrl;
  }
}

// Scoped to whatever's currently selected instead of showing every active
// story at once: a folder shows stories from every source under it, INCLUDING
// subfolders (same rollup as unread counts/item listing), a single source
// shows just its own, and anything broader (all items/starred/tag/search)
// shows none — there's no single folder/source to scope it to there.
// flattenFolderNodes is needed here (not folders.find) because the selected
// folder may be nested several levels deep, not necessarily one of the
// top-level entries `folders` itself contains.
function storySourcesForScope(folders: FolderNode[], scope: SelectedScope) {
  if (scope.kind === 'folder') {
    const folder = flattenFolderNodes(folders).find((f) => f.id === scope.id);
    if (!folder) return [];
    return collectAllSources(folder).filter((s) => s.type === 'instagram' && s.hasActiveStory);
  }
  if (scope.kind === 'source') {
    const source = folders.flatMap(collectAllSources).find((s) => s.id === scope.id);
    return source && source.type === 'instagram' && source.hasActiveStory ? [source] : [];
  }
  return [];
}

/**
 * Shows only sources the extension detected an active story ring on during its
 * last visit (Source.hasActiveStory) — never opens the story itself (that would
 * mark it "seen" for the poster), just links out to instagram.com/stories/:user/
 * so viewing it is a real, manual action on your part, same as browsing there directly.
 */
export function StoriesBar({
  folders,
  scope,
  onStoryViewed,
}: {
  folders: FolderNode[];
  scope: SelectedScope;
  onStoryViewed: (sourceId: string) => void;
}) {
  const activeStories = storySourcesForScope(folders, scope);

  if (activeStories.length === 0) return null;

  return (
    <div className="stories-bar">
      {activeStories.map((s) => (
        <a
          key={s.id}
          className={`story-chip ${s.storyAcknowledged ? 'seen' : ''}`}
          href={`https://www.instagram.com/stories/${extractInstagramUsername(s.identityUrl)}/`}
          target="_blank"
          rel="noreferrer"
          title={`Ver story de ${s.title}`}
          onClick={() => onStoryViewed(s.id)}
        >
          <span className="story-ring">◈</span>
          <span className="story-name">{s.title}</span>
        </a>
      ))}
    </div>
  );
}
