import type { FolderNode, SourceSummary } from './types';

export interface FlatFolderOption {
  id: string;
  name: string;
  depth: number;
}

/** Flattens the nested folder tree into a depth-annotated list, e.g. for a
 *  "pick a destination folder" dialog that needs every folder regardless of
 *  nesting level, not just the top-level ones. */
export function flattenFolders(folders: FolderNode[], depth = 0): FlatFolderOption[] {
  return folders.flatMap((f) => [{ id: f.id, name: f.name, depth }, ...flattenFolders(f.children, depth + 1)]);
}

/** A folder's own id plus every descendant's id — the set of invalid new-parent
 *  targets for that folder (picking any of them would create a cycle). */
export function collectDescendantIds(folder: FolderNode): Set<string> {
  const ids = new Set<string>([folder.id]);
  for (const child of folder.children) {
    for (const id of collectDescendantIds(child)) ids.add(id);
  }
  return ids;
}

/** Flattens the tree into a single array of the full FolderNode objects
 *  (regardless of nesting depth), e.g. to look up any folder or its siblings
 *  by id/parentId without caring where in the tree it lives. */
export function flattenFolderNodes(folders: FolderNode[]): FolderNode[] {
  return folders.flatMap((f) => [f, ...flattenFolderNodes(f.children)]);
}

/** A folder's own sources plus every descendant subfolder's — same "this
 *  folder acts as a category" rollup the backend already does for unread
 *  counts/item listing/refresh/mark-all-read, needed here too so a parent
 *  folder's Stories bar isn't limited to sources attached to it directly. */
export function collectAllSources(folder: FolderNode): SourceSummary[] {
  return [...folder.sources, ...folder.children.flatMap(collectAllSources)];
}
