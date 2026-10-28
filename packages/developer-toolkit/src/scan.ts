import type { Dirent } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import { isExcludedDirectory } from "./paths.js";

export type WalkLimits = { maxEntries: number; maxDepth: number };
export type WalkedEntry = { name: string; path: string; absolute: string; type: "file" | "directory"; depth: number; size?: number; mtimeMs?: number };
export type WalkSummary = { files: number; directories: number; symlinks: number; unreadable: number; excluded: string[]; truncated: boolean };
/** Return false to stop the walk early. */
export type Visitor = (entry: WalkedEntry) => boolean | void;

const byName = (a: Dirent, b: Dirent) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

/**
 * Breadth-first, bounded walk. Symbolic links (and Windows junctions) are counted but never followed,
 * excluded directories are never entered, and unreadable directories are skipped instead of failing the scan.
 */
export async function walk(start: { absolute: string; relative: string }, limits: WalkLimits, visit: Visitor, withStats = false): Promise<WalkSummary> {
  const summary: WalkSummary = { files: 0, directories: 0, symlinks: 0, unreadable: 0, excluded: [], truncated: false };
  const excluded = new Set<string>();
  let queue = [{ absolute: start.absolute, relative: start.relative, depth: 0 }];
  let seen = 0, stopped = false;
  while (queue.length && !stopped) {
    const next: typeof queue = [];
    for (const dir of queue) {
      let entries: Dirent[];
      try { entries = await readdir(dir.absolute, { withFileTypes: true }); }
      catch { summary.unreadable++; continue; }
      const files: WalkedEntry[] = [];
      for (const entry of entries.sort(byName)) {
        if (seen >= limits.maxEntries) { summary.truncated = stopped = true; break; }
        seen++;
        const relative = dir.relative ? dir.relative + "/" + entry.name : entry.name;
        const absolute = path.join(dir.absolute, entry.name);
        const depth = dir.depth + 1;
        if (entry.isSymbolicLink()) summary.symlinks++;
        else if (entry.isDirectory()) {
          if (isExcludedDirectory(entry.name)) { excluded.add(entry.name); continue; }
          summary.directories++;
          if (visit({ name: entry.name, path: relative, absolute, type: "directory", depth }) === false) { stopped = true; break; }
          if (depth < limits.maxDepth) next.push({ absolute, relative, depth });
          else summary.truncated = true;
        } else if (entry.isFile()) files.push({ name: entry.name, path: relative, absolute, type: "file", depth });
      }
      if (withStats) {
        await Promise.all(files.map(async file => {
          try { const info = await lstat(file.absolute); file.size = info.size; file.mtimeMs = info.mtimeMs; }
          catch { file.size = 0; }
        }));
      }
      for (const file of files) {
        summary.files++;
        if (visit(file) === false) { stopped = true; break; }
      }
      if (stopped) break;
    }
    queue = next;
  }
  summary.excluded = [...excluded].sort();
  return summary;
}
