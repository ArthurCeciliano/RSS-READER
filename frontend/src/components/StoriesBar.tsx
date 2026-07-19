import type { FolderNode } from '../types';
import './StoriesBar.css';

function extractInstagramUsername(identityUrl: string): string {
  try {
    return new URL(identityUrl).pathname.replace(/^\/|\/$/g, '');
  } catch {
    return identityUrl;
  }
}

/**
 * Shows only sources the extension detected an active story ring on during its
 * last visit (Source.hasActiveStory) — never opens the story itself (that would
 * mark it "seen" for the poster), just links out to instagram.com/stories/:user/
 * so viewing it is a real, manual action on your part, same as browsing there directly.
 */
export function StoriesBar({ folders }: { folders: FolderNode[] }) {
  const activeStories = folders.flatMap((f) => f.sources).filter((s) => s.type === 'instagram' && s.hasActiveStory);

  if (activeStories.length === 0) return null;

  return (
    <div className="stories-bar">
      {activeStories.map((s) => (
        <a
          key={s.id}
          className="story-chip"
          href={`https://www.instagram.com/stories/${extractInstagramUsername(s.identityUrl)}/`}
          target="_blank"
          rel="noreferrer"
          title={`Ver story de ${s.title}`}
        >
          <span className="story-ring">◈</span>
          <span className="story-name">{s.title}</span>
        </a>
      ))}
    </div>
  );
}
