import type { Dirent } from "node:fs";
import { lstat, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_CONFIG_FILE, PROJECT_ID, loadCatalog } from "./config.js";
import { describeProject, detectFrameworks, detectStack, type ManifestInfo } from "./detect.js";
import { DeveloperToolkitError } from "./errors.js";
import { languageStats } from "./languages.js";
import { ECOSYSTEMS, manifestTypeOf, parseManifest } from "./manifests.js";
import { extensionOf, isExcludedDirectory, isSensitiveFile, resolveInside } from "./paths.js";
import { walk, type WalkedEntry } from "./scan.js";
import type {
  Dependency, DependencyAnalysis, DependencyScope, DevProject, EntryType, FileEntry, ManifestReport, ProjectCatalog,
  ProjectFileSearch, ProjectInspection, ProjectStructure, ProjectTree, StructureOptions, TreeNode
} from "./types.js";

export type * from "./types.js";
export { DeveloperToolkitError } from "./errors.js";
export { DEFAULT_CONFIG_FILE } from "./config.js";
export { EXCLUDED_DIRECTORIES, isSensitiveFile, normalizeRelativePath, resolveInside } from "./paths.js";
export { parseGradle, parseManifest, parsePackageJson, parsePomXml, parsePyproject, parseRequirements } from "./manifests.js";

export type ToolkitLimits = {
  maxEntries: number; maxDepth: number; maxManifests: number; maxManifestBytes: number; maxTreeNodes: number; maxSearchResults: number;
};
export const DEFAULT_LIMITS: ToolkitLimits = {
  maxEntries: 25_000, maxDepth: 16, maxManifests: 60, maxManifestBytes: 1_000_000, maxTreeNodes: 2_000, maxSearchResults: 500
};
export type ToolkitOptions = { configFile?: string; limits?: Partial<ToolkitLimits> };

const SCOPE_ORDER: DependencyScope[] = ["production", "peer", "optional", "provided", "development", "build", "managed"];
const normalizeName = (name: string) => name.toLowerCase().replace(/[-_.]+/g, "-");
const directoriesFirst = (a: Dirent, b: Dirent) =>
  Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name, "en", { sensitivity: "base", numeric: true });

function integer(value: number | undefined, fallback: number, min: number, max: number, label: string): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) throw new DeveloperToolkitError("INVALID_INPUT", `${label} must be an integer between ${min} and ${max}`);
  return value;
}
function normalizeExtensions(extensions: string[] | undefined): string[] {
  if (!extensions) return [];
  if (!Array.isArray(extensions) || extensions.length > 20) throw new DeveloperToolkitError("INVALID_INPUT", "Provide at most 20 extensions");
  const normalized = extensions.map(e => String(e).trim().replace(/^\./, "").toLowerCase()).filter(Boolean);
  if (normalized.some(e => !/^[a-z0-9]{1,16}$/.test(e))) throw new DeveloperToolkitError("INVALID_INPUT", "Extensions may only contain letters and digits");
  return [...new Set(normalized)];
}

async function describeEntry(directory: string, relative: string, entry: Dirent): Promise<FileEntry> {
  const type: EntryType = entry.isSymbolicLink() ? "symlink" : entry.isDirectory() ? "directory" : "file";
  const node: FileEntry = { name: entry.name, path: relative ? `${relative}/${entry.name}` : entry.name, type };
  try {
    const info = await lstat(path.join(directory, entry.name));
    node.modifiedAt = info.mtime.toISOString();
    if (type === "file") node.size = info.size;
  } catch { /* entry removed while listing */ }
  if (type === "file") {
    const extension = extensionOf(entry.name);
    if (extension) node.extension = extension;
    if (isSensitiveFile(entry.name)) node.sensitive = true;
  }
  if (type === "directory" && isExcludedDirectory(entry.name)) node.excluded = true;
  return node;
}

/**
 * Read-only inspection of local projects explicitly allowed by the owner in the projects file.
 * Every path goes through resolveInside(): no traversal, no symlink escape, no excluded directory, and file
 * contents are only read for known dependency manifests (never for arbitrary or sensitive files).
 */
export class DeveloperToolkit {
  readonly configFile: string;
  private readonly limits: ToolkitLimits;
  constructor(options: ToolkitOptions = {}) {
    this.configFile = path.resolve(options.configFile ?? (process.env.NEXUS_DEV_PROJECTS_FILE || DEFAULT_CONFIG_FILE));
    this.limits = { ...DEFAULT_LIMITS, ...options.limits };
  }

  listProjects(): Promise<ProjectCatalog> { return loadCatalog(this.configFile); }

  private async project(id: string): Promise<DevProject> {
    if (typeof id !== "string" || !PROJECT_ID.test(id)) throw new DeveloperToolkitError("INVALID_INPUT", "Invalid project ID");
    const project = (await this.listProjects()).projects.find(p => p.id === id);
    if (!project) throw new DeveloperToolkitError("PROJECT_NOT_FOUND", `Project "${id}" is not configured`);
    if (project.status !== "ready") throw new DeveloperToolkitError("PROJECT_UNAVAILABLE", `Project "${id}" is unavailable: ${project.issue}`);
    return project;
  }

  private async scan(project: DevProject, withStats: boolean) {
    const files: WalkedEntry[] = [];
    const summary = await walk({ absolute: project.path, relative: "" }, this.limits, entry => { if (entry.type === "file") files.push(entry); }, withStats);
    return { files, summary };
  }

  private async readManifests(project: DevProject, files: WalkedEntry[]) {
    const candidates = files.flatMap(file => { const type = manifestTypeOf(file.name); return type ? [{ file, type }] : []; });
    const reports: ManifestReport[] = [], infos: ManifestInfo[] = [], dependencies: Dependency[] = [];
    for (const { file, type } of candidates.slice(0, this.limits.maxManifests)) {
      const report: ManifestReport = { path: file.path, type, ecosystem: ECOSYSTEMS[type], dependencyCount: 0, warnings: [] };
      reports.push(report);
      try {
        const { absolute } = await resolveInside(project.path, file.path);
        const info = await stat(absolute);
        if (!info.isFile()) throw new Error("not a regular file");
        if (info.size > this.limits.maxManifestBytes) { report.warnings.push(`Skipped: larger than ${this.limits.maxManifestBytes} bytes`); continue; }
        const parsed = parseManifest(type, file.name, await readFile(absolute, "utf8"));
        Object.assign(report, { packageName: parsed.packageName, packageVersion: parsed.packageVersion, dependencyCount: parsed.dependencies.length });
        report.warnings.push(...parsed.warnings);
        infos.push({ path: file.path, type, signals: parsed.signals });
        for (const dependency of parsed.dependencies) dependencies.push({ ...dependency, ecosystem: ECOSYSTEMS[type], manifest: file.path, internal: false });
      } catch (e) {
        report.warnings.push(`Could not read manifest: ${e instanceof DeveloperToolkitError || e instanceof Error ? e.message : String(e)}`);
      }
    }
    const ownNames = new Set(reports.flatMap(r => r.packageName ? [normalizeName(r.packageName)] : []));
    for (const dependency of dependencies) {
      dependency.internal = ownNames.has(normalizeName(dependency.name)) || !!dependency.version?.startsWith("workspace:") || dependency.name.startsWith(":");
    }
    return { reports, infos, dependencies, truncated: candidates.length > this.limits.maxManifests };
  }

  async inspectProject(id: string): Promise<ProjectInspection> {
    const started = Date.now();
    const project = await this.project(id);
    const { files, summary } = await this.scan(project, true);
    const manifests = await this.readManifests(project, files);
    const paths = files.map(f => f.path);
    const stack = detectStack(paths, manifests.infos);
    const { languages, dataFormats } = languageStats(files);
    const frameworks = detectFrameworks(manifests.dependencies, stack.configFiles.map(c => c.path));
    const extensionCounts = new Map<string, number>();
    for (const file of files) { const extension = extensionOf(file.name); if (extension) extensionCounts.set(extension, (extensionCounts.get(extension) ?? 0) + 1); }
    return {
      project, scannedAt: new Date().toISOString(),
      summary: describeProject({ language: languages.find(l => l.category === "programming")?.name, monorepo: stack.monorepo, frameworks, packageManagers: stack.packageManagers, buildTools: stack.buildTools }),
      monorepo: stack.monorepo,
      stats: {
        files: summary.files, directories: summary.directories, totalBytes: files.reduce((sum, f) => sum + (f.size ?? 0), 0),
        symlinks: summary.symlinks, unreadable: summary.unreadable, excludedDirectories: summary.excluded,
        truncated: summary.truncated || manifests.truncated, durationMs: Date.now() - started
      },
      languages, dataFormats, frameworks, buildTools: stack.buildTools, packageManagers: stack.packageManagers, configFiles: stack.configFiles,
      manifests: manifests.reports.map(m => ({ path: m.path, type: m.type })),
      topExtensions: [...extensionCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12).map(([extension, count]) => ({ extension, files: count }))
    };
  }

  async analyzeDependencies(id: string): Promise<DependencyAnalysis> {
    const project = await this.project(id);
    const { files, summary } = await this.scan(project, false);
    const manifests = await this.readManifests(project, files);
    const order = new Map(manifests.reports.map((r, index) => [r.path, index]));
    const dependencies = manifests.dependencies.sort((a, b) =>
      order.get(a.manifest)! - order.get(b.manifest)! || SCOPE_ORDER.indexOf(a.scope) - SCOPE_ORDER.indexOf(b.scope) || a.name.localeCompare(b.name));
    const byScope: DependencyAnalysis["summary"]["byScope"] = {}, byEcosystem: DependencyAnalysis["summary"]["byEcosystem"] = {};
    for (const d of dependencies) { byScope[d.scope] = (byScope[d.scope] ?? 0) + 1; byEcosystem[d.ecosystem] = (byEcosystem[d.ecosystem] ?? 0) + 1; }
    const stack = detectStack(files.map(f => f.path), manifests.infos);
    return {
      project, analyzedAt: new Date().toISOString(), manifests: manifests.reports, dependencies,
      packageManagers: stack.packageManagers, technologies: detectFrameworks(dependencies),
      summary: {
        total: dependencies.length, unique: new Set(dependencies.map(d => `${d.ecosystem}:${normalizeName(d.name)}`)).size,
        internal: dependencies.filter(d => d.internal).length, byScope, byEcosystem
      },
      truncated: summary.truncated || manifests.truncated
    };
  }

  async getProjectStructure(id: string, options: StructureOptions = {}): Promise<ProjectStructure> {
    const project = await this.project(id);
    const depth = integer(options.depth, 2, 1, 5, "depth");
    const limit = integer(options.limit, Math.min(200, this.limits.maxSearchResults), 1, this.limits.maxSearchResults, "limit");
    const query = options.query?.trim() || undefined;
    if (query && query.length > 120) throw new DeveloperToolkitError("INVALID_INPUT", "Search query must be at most 120 characters");
    const extensions = normalizeExtensions(options.extensions);
    const start = await resolveInside(project.path, options.path ?? "");
    if (!(await stat(start.absolute)).isDirectory()) throw new DeveloperToolkitError("NOT_A_DIRECTORY", "Path is not a directory");
    return query || extensions.length ? this.search(project, start, limit, query, extensions) : this.tree(project, start, depth);
  }

  private async tree(project: DevProject, start: { absolute: string; relative: string }, depth: number): Promise<ProjectTree> {
    let nodeCount = 0, truncated = false;
    const build = async (absolute: string, relative: string, level: number): Promise<TreeNode[]> => {
      let entries: Dirent[];
      try { entries = await readdir(absolute, { withFileTypes: true }); } catch { return []; }
      entries = entries.filter(e => e.isFile() || e.isDirectory() || e.isSymbolicLink()).sort(directoriesFirst);
      const room = this.limits.maxTreeNodes - nodeCount;
      if (entries.length > room) { truncated = true; entries = entries.slice(0, Math.max(0, room)); }
      nodeCount += entries.length;
      const nodes: TreeNode[] = await Promise.all(entries.map(entry => describeEntry(absolute, relative, entry)));
      for (const node of nodes) {
        if (node.type === "directory" && !node.excluded && level < depth) node.children = await build(path.join(absolute, node.name), node.path, level + 1);
      }
      return nodes;
    };
    const info = await lstat(start.absolute);
    const root: TreeNode = {
      name: start.relative ? start.relative.slice(start.relative.lastIndexOf("/") + 1) : project.name,
      path: start.relative, type: "directory", modifiedAt: info.mtime.toISOString(), children: await build(start.absolute, start.relative, 1)
    };
    return { mode: "tree", project, path: start.relative, depth, root, nodeCount, truncated };
  }

  private async search(project: DevProject, start: { absolute: string; relative: string }, limit: number, query: string | undefined, extensions: string[]): Promise<ProjectFileSearch> {
    const needle = query?.toLowerCase().replace(/\\/g, "/");
    const found: WalkedEntry[] = [];
    let truncated = false;
    const summary = await walk(start, this.limits, entry => {
      if (entry.type === "directory" && (extensions.length || !needle)) return;
      if (entry.type === "file" && extensions.length && !extensions.includes(extensionOf(entry.name))) return;
      if (needle && !(needle.includes("/") ? entry.path : entry.name).toLowerCase().includes(needle)) return;
      if (found.length >= limit) { truncated = true; return false; }
      found.push(entry);
    });
    const matches = await Promise.all(found.sort((a, b) => a.path.localeCompare(b.path)).map(async entry => {
      const match: FileEntry = { name: entry.name, path: entry.path, type: entry.type };
      try {
        const info = await lstat(entry.absolute);
        match.modifiedAt = info.mtime.toISOString();
        if (entry.type === "file") match.size = info.size;
      } catch { /* removed during search */ }
      if (entry.type === "file") {
        const extension = extensionOf(entry.name);
        if (extension) match.extension = extension;
        if (isSensitiveFile(entry.name)) match.sensitive = true;
      }
      return match;
    }));
    return {
      mode: "search", project, path: start.relative, ...(query ? { query } : {}), ...(extensions.length ? { extensions } : {}),
      matches, scanned: summary.files + summary.directories, truncated: truncated || summary.truncated
    };
  }
}
