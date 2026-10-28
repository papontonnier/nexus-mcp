// Public contracts shared by the API, the MCP server and (type-only) the web app.
// Keep this file free of runtime imports so browsers can consume it.

export type ProjectStatus = "ready" | "missing" | "invalid";
export type DevProject = { id: string; name: string; path: string; description?: string; status: ProjectStatus; issue?: string };
export type ProjectCatalog = { configFile: string; configFound: boolean; projects: DevProject[]; issues: string[] };

export type LanguageCategory = "programming" | "markup" | "data" | "prose";
export type LanguageStat = { name: string; category: LanguageCategory; files: number; bytes: number; percent: number };
export type Detection = { name: string; category: string; evidence: string[] };
export type ConfigFile = { path: string; kind: string; sensitive: boolean };
export type ScanStats = {
  files: number; directories: number; totalBytes: number; symlinks: number; unreadable: number;
  excludedDirectories: string[]; truncated: boolean; durationMs: number;
};

export type Ecosystem = "npm" | "maven" | "gradle" | "pypi";
export type ManifestType = "package.json" | "pom.xml" | "build.gradle" | "build.gradle.kts" | "requirements.txt" | "pyproject.toml";
export type DependencyScope = "production" | "development" | "peer" | "optional" | "provided" | "build" | "managed";
export type Dependency = {
  name: string; version: string | null; scope: DependencyScope; rawScope: string;
  ecosystem: Ecosystem; manifest: string; internal: boolean;
};
export type ManifestReport = {
  path: string; type: ManifestType; ecosystem: Ecosystem; packageName?: string; packageVersion?: string;
  dependencyCount: number; warnings: string[];
};

export type ProjectInspection = {
  project: DevProject; scannedAt: string; summary: string; monorepo: boolean; stats: ScanStats;
  languages: LanguageStat[]; dataFormats: LanguageStat[];
  frameworks: Detection[]; buildTools: Detection[]; packageManagers: Detection[];
  configFiles: ConfigFile[]; manifests: { path: string; type: ManifestType }[];
  topExtensions: { extension: string; files: number }[];
};

export type DependencyAnalysis = {
  project: DevProject; analyzedAt: string; manifests: ManifestReport[]; dependencies: Dependency[];
  packageManagers: Detection[]; technologies: Detection[];
  summary: { total: number; unique: number; internal: number; byScope: Partial<Record<DependencyScope, number>>; byEcosystem: Partial<Record<Ecosystem, number>> };
  truncated: boolean;
};

export type EntryType = "directory" | "file" | "symlink";
export type FileEntry = {
  name: string; path: string; type: EntryType; size?: number; modifiedAt?: string;
  extension?: string; sensitive?: boolean; excluded?: boolean;
};
export type TreeNode = FileEntry & { children?: TreeNode[] };
export type StructureOptions = { path?: string; depth?: number; query?: string; extensions?: string[]; limit?: number };
export type ProjectTree = { mode: "tree"; project: DevProject; path: string; depth: number; root: TreeNode; nodeCount: number; truncated: boolean };
export type ProjectFileSearch = {
  mode: "search"; project: DevProject; path: string; query?: string; extensions?: string[];
  matches: FileEntry[]; scanned: number; truncated: boolean;
};
export type ProjectStructure = ProjectTree | ProjectFileSearch;

export type ErrorCode =
  | "PROJECT_NOT_FOUND" | "PROJECT_UNAVAILABLE" | "INVALID_INPUT" | "INVALID_PATH" | "PATH_OUTSIDE_PROJECT"
  | "EXCLUDED_PATH" | "PATH_NOT_FOUND" | "NOT_A_DIRECTORY";
