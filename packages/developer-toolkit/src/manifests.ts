import type { DependencyScope, Ecosystem, ManifestType } from "./types.js";
import { isTable, parseToml, type TomlTable, type TomlValue } from "./toml.js";

export type ParsedDependency = { name: string; version: string | null; scope: DependencyScope; rawScope: string };
export type ManifestSignals = { packageManager?: string; workspaces?: boolean; modules?: number; poetry?: boolean; uv?: boolean; buildBackend?: string };
export type ParsedManifest = { packageName?: string; packageVersion?: string; dependencies: ParsedDependency[]; warnings: string[]; signals: ManifestSignals };

export const ECOSYSTEMS: Record<ManifestType, Ecosystem> = {
  "package.json": "npm", "pom.xml": "maven", "build.gradle": "gradle", "build.gradle.kts": "gradle",
  "requirements.txt": "pypi", "pyproject.toml": "pypi"
};
const REQUIREMENTS_FILE = /^(?:requirements|(?:dev|test)[-_]requirements|requirements[-_](?:dev|test|tests|lint|docs?))\.txt$/i;
export function manifestTypeOf(name: string): ManifestType | undefined {
  if (name in ECOSYSTEMS && name !== "requirements.txt") return name as ManifestType;
  return REQUIREMENTS_FILE.test(name) ? "requirements.txt" : undefined;
}

const empty = (): ParsedManifest => ({ dependencies: [], warnings: [], signals: {} });
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
/** Never echo credentials embedded in URLs (git+https://user:token@host/...). */
export const redactCredentials = (value: string) => value.replace(/(\/\/)[^/@\s]+@/g, "$1***@");
const clip = (value: string) => redactCredentials(value.length > 120 ? value.slice(0, 117) + "…" : value);
const DEV_GROUP = /^(?:dev|devel|develop|development|test|tests|testing|lint|linting|docs?|typing|types|qa)$/i;

// ── npm ────────────────────────────────────────────────────────────────────────
export function parsePackageJson(content: string): ParsedManifest {
  const result = empty();
  const data: unknown = JSON.parse(content.replace(/^﻿/, ""));
  if (!isRecord(data)) throw new Error("package.json must contain a JSON object");
  if (typeof data.name === "string") result.packageName = data.name;
  if (typeof data.version === "string") result.packageVersion = data.version;
  if (typeof data.packageManager === "string") result.signals.packageManager = data.packageManager.slice(0, 80);
  if (data.workspaces !== undefined) result.signals.workspaces = true;
  const sections: [string, DependencyScope][] = [
    ["dependencies", "production"], ["devDependencies", "development"], ["peerDependencies", "peer"], ["optionalDependencies", "optional"]
  ];
  for (const [key, scope] of sections) {
    const section = data[key];
    if (section === undefined) continue;
    if (!isRecord(section)) { result.warnings.push(`"${key}" is not an object`); continue; }
    for (const [name, version] of Object.entries(section)) {
      if (typeof version === "string") result.dependencies.push({ name, version: clip(version), scope, rawScope: key });
      else result.warnings.push(`Ignored non-string version for ${clip(name)} in ${key}`);
    }
  }
  return result;
}

// ── Maven ──────────────────────────────────────────────────────────────────────
// Regex extraction instead of an XML parser: no DTD or entity expansion (XXE-safe) and no dependency.
const decodeXml = (value: string) => value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const blocks = (xml: string, tag: string) => [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g"))].map(m => m[1]);
const without = (xml: string, ...tags: string[]) => tags.reduce((text, tag) => text.replace(new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?</${tag}>`, "g"), ""), xml);
const text = (xml: string, tag: string) => {
  const match = new RegExp(`<${tag}>\\s*([^<]*?)\\s*</${tag}>`).exec(xml);
  return match ? decodeXml(match[1]) : undefined;
};
const MAVEN_SCOPES: Record<string, DependencyScope> = { compile: "production", runtime: "production", test: "development", provided: "provided", system: "provided", import: "managed" };

export function parsePomXml(content: string): ParsedManifest {
  const result = empty();
  const xml = content.replace(/<!--[\s\S]*?-->/g, "");
  if (!/<project[\s>]/.test(xml)) throw new Error("No <project> element found");
  const parent = blocks(xml, "parent")[0] ?? "";
  const own = without(xml, "parent", "dependencies", "dependencyManagement", "build", "profiles", "properties", "reporting", "modules", "distributionManagement", "repositories", "pluginRepositories", "developers", "contributors", "scm", "licenses", "organization", "issueManagement", "ciManagement", "mailingLists");
  const groupId = text(own, "groupId") ?? text(parent, "groupId");
  const artifactId = text(own, "artifactId");
  const version = text(own, "version") ?? text(parent, "version");
  if (artifactId) result.packageName = groupId ? `${groupId}:${artifactId}` : artifactId;
  if (version) result.packageVersion = version;
  const properties = new Map<string, string>();
  for (const block of blocks(without(xml, "profiles"), "properties")) {
    for (const match of block.matchAll(/<([A-Za-z0-9_.-]+)>\s*([^<]*?)\s*<\/\1>/g)) properties.set(match[1], decodeXml(match[2]));
  }
  for (const [key, value] of [["project.version", version], ["project.groupId", groupId], ["project.artifactId", artifactId], ["project.parent.version", text(parent, "version")]]) {
    if (key && value) properties.set(key, value);
  }
  const resolve = (value: string | undefined) => {
    let resolved = value;
    for (let i = 0; i < 5 && resolved?.includes("${"); i++) resolved = resolved.replace(/\$\{([^}]+)\}/g, (raw, key: string) => properties.get(key) ?? raw);
    return resolved;
  };
  const modules = blocks(xml, "modules")[0];
  if (modules) result.signals.modules = blocks(modules, "module").length;
  const read = (block: string, managed: boolean) => {
    const group = resolve(text(block, "groupId")), artifact = resolve(text(block, "artifactId"));
    if (!artifact) { result.warnings.push("Ignored a <dependency> without artifactId"); return; }
    const rawScope = text(block, "scope") ?? "compile";
    const scope: DependencyScope = managed ? "managed" : text(block, "optional") === "true" ? "optional" : MAVEN_SCOPES[rawScope] ?? "production";
    result.dependencies.push({ name: group ? `${group}:${artifact}` : artifact, version: resolve(text(block, "version")) ?? null, scope, rawScope: managed ? `dependencyManagement:${rawScope}` : rawScope });
  };
  for (const management of blocks(without(xml, "profiles"), "dependencyManagement")) for (const block of blocks(management, "dependency")) read(block, true);
  for (const block of blocks(without(xml, "dependencyManagement", "build", "profiles", "reporting"), "dependency")) read(block, false);
  if (/<profiles[\s>]/.test(xml)) result.warnings.push("Dependencies declared inside <profiles> are not analyzed");
  return result;
}

// ── Gradle ─────────────────────────────────────────────────────────────────────
const GRADLE_LINE = /^\s*([a-z][A-Za-z]*(?:Implementation|Api|CompileOnly|RuntimeOnly)|implementation|api|compileOnly|compileOnlyApi|runtimeOnly|annotationProcessor|kapt|ksp|classpath|developmentOnly|compile|runtime|testCompile|testRuntime|providedCompile|providedRuntime)\b(?!\s*[=.{])\s*\(?\s*(.+)$/gm;
function gradleScope(configuration: string): DependencyScope {
  if (/test/i.test(configuration) || configuration === "developmentOnly") return "development";
  if (/^(?:compileOnly|compileOnlyApi|providedCompile|providedRuntime)$/.test(configuration)) return "provided";
  if (/^(?:annotationProcessor|kapt|ksp|classpath)$/.test(configuration)) return "build";
  return "production";
}
export function parseGradle(content: string): ParsedManifest {
  const result = empty();
  const source = content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
  const variables = new Map<string, string>();
  for (const match of source.matchAll(/^\s*(?:val|var|def|ext\.|set\(\s*["'])?\s*([A-Za-z_][\w]*)["']?\s*[=,]\s*["']([^"'$\n]+)["']/gm)) variables.set(match[1], match[2]);
  const resolve = (value: string) => value.replace(/\$\{?([A-Za-z_][\w.]*)\}?/g, (raw, key: string) => variables.get(key.replace(/^(?:project\.|rootProject\.)?(?:ext\.)?/, "")) ?? raw);
  for (const [, configuration, rest] of source.matchAll(GRADLE_LINE)) {
    let scope = gradleScope(configuration), rawScope = configuration, args = rest.trim();
    const platform = /^(?:enforcedPlatform|platform)\s*\(\s*(.+)$/.exec(args);
    if (platform) { scope = "managed"; rawScope = `${configuration} (platform)`; args = platform[1]; }
    const project = /^project\s*\(\s*(?:path\s*[:=]\s*)?["']([^"']+)["']/.exec(args);
    const kotlin = /^kotlin\s*\(\s*["']([^"']+)["']/.exec(args);
    const catalog = /^(libs\.[\w.]+)/.exec(args);
    const quoted = /^["']([^"']+)["']/.exec(args);
    const map = /group\s*[:=]\s*["']([^"']+)["']\s*,\s*name\s*[:=]\s*["']([^"']+)["'](?:\s*,\s*version\s*[:=]\s*["']([^"']+)["'])?/.exec(args);
    if (project) result.dependencies.push({ name: project[1], version: null, scope, rawScope });
    else if (kotlin) result.dependencies.push({ name: `org.jetbrains.kotlin:kotlin-${kotlin[1]}`, version: null, scope, rawScope });
    else if (catalog) result.dependencies.push({ name: catalog[1], version: null, scope, rawScope: `${rawScope} (version catalog)` });
    else if (map) result.dependencies.push({ name: `${map[1]}:${map[2]}`, version: map[3] ? resolve(map[3]) : null, scope, rawScope });
    else if (quoted) {
      const [group, name, version] = resolve(quoted[1]).split(":");
      if (!name) { result.warnings.push(`Ignored unrecognized ${configuration} declaration`); continue; }
      result.dependencies.push({ name: `${group}:${name}`, version: version ? clip(version.split("@")[0]) : null, scope, rawScope });
    } else if (!/^(?:files|fileTree|gradleApi|localGroovy|gradleTestKit)\s*\(/.test(args)) {
      result.warnings.push(`Ignored unrecognized ${configuration} declaration`);
    }
  }
  return result;
}

// ── Python ─────────────────────────────────────────────────────────────────────
const REQUIREMENT = /^([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)\s*(?:\[[^\]]*\])?\s*(.*)$/s;
/** Parses a PEP 508 requirement ("pandas[excel]>=2.0; python_version>'3.9'") into name + version specifier. */
export function parseRequirement(raw: string): { name: string; version: string | null } | null {
  const match = REQUIREMENT.exec(raw.trim());
  if (!match) return null;
  let rest = match[2].split(";")[0].trim();
  if (rest.startsWith("@")) return { name: match[1], version: "(direct reference)" };
  rest = rest.split(/\s+--/)[0].trim().replace(/^\((.*)\)$/, "$1").trim();
  if (rest && !/^(?:[<>=!~]=?|===)/.test(rest)) return null;
  return { name: match[1], version: rest ? clip(rest) : null };
}
export function parseRequirements(content: string, fileName = "requirements.txt"): ParsedManifest {
  const result = empty();
  const scope: DependencyScope = /dev|test|lint|doc/i.test(fileName) ? "development" : "production";
  let skipped = 0;
  for (const line of content.replace(/^﻿/, "").replace(/\\\r?\n/g, " ").split(/\r?\n/)) {
    const entry = line.replace(/(^|\s)#.*$/, "").trim();
    if (!entry) continue;
    // Options (-r, -c, --index-url …) are never echoed: index URLs frequently embed credentials.
    if (entry.startsWith("-")) { if (/^-e\b|^--editable\b/.test(entry)) skipped++; continue; }
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(entry) || /^[./~\\]/.test(entry) || /^[A-Za-z]:[\\/]/.test(entry)) {
      const egg = /#egg=([A-Za-z0-9._-]+)/.exec(entry);
      if (egg) result.dependencies.push({ name: egg[1], version: "(direct reference)", scope, rawScope: fileName });
      else skipped++;
      continue;
    }
    const requirement = parseRequirement(entry);
    if (requirement) result.dependencies.push({ ...requirement, scope, rawScope: fileName });
    else result.warnings.push(`Unrecognized requirement: ${clip(entry)}`);
  }
  if (skipped) result.warnings.push(`${skipped} editable, URL or local path requirement(s) not analyzed`);
  return result;
}

const strings = (value: TomlValue | undefined) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const tableAt = (root: TomlTable, ...keys: string[]): TomlTable | undefined => {
  let current: TomlValue | undefined = root;
  for (const key of keys) current = isTable(current) && Object.hasOwn(current, key) ? current[key] : undefined;
  return isTable(current) ? current : undefined;
};
function poetryVersion(value: TomlValue): { version: string | null; optional: boolean } {
  if (typeof value === "string") return { version: clip(value), optional: false };
  if (Array.isArray(value)) return { version: "(multiple constraints)", optional: false };
  if (isTable(value)) {
    const optional = value.optional === true;
    if (typeof value.version === "string") return { version: clip(value.version), optional };
    if (value.git || value.path || value.url) return { version: "(direct reference)", optional };
  }
  return { version: null, optional: false };
}

export function parsePyproject(content: string): ParsedManifest {
  const result = empty();
  const doc = parseToml(content);
  const project = tableAt(doc, "project"), poetry = tableAt(doc, "tool", "poetry"), uv = tableAt(doc, "tool", "uv");
  const name = project?.name ?? poetry?.name, version = project?.version ?? poetry?.version;
  if (typeof name === "string") result.packageName = name;
  if (typeof version === "string") result.packageVersion = version;
  const add = (requirements: string[], scope: DependencyScope, rawScope: string) => {
    for (const raw of requirements) {
      const requirement = parseRequirement(raw);
      if (requirement) result.dependencies.push({ ...requirement, scope, rawScope });
      else result.warnings.push(`Unrecognized requirement in ${rawScope}: ${clip(raw)}`);
    }
  };
  add(strings(project?.dependencies), "production", "project.dependencies");
  for (const [group, list] of Object.entries(tableAt(doc, "project", "optional-dependencies") ?? {})) {
    add(strings(list), DEV_GROUP.test(group) ? "development" : "optional", `optional:${group}`);
  }
  for (const [group, list] of Object.entries(tableAt(doc, "dependency-groups") ?? {})) add(strings(list), "development", `group:${group}`);
  if (poetry) {
    result.signals.poetry = true;
    const poetryTables: [TomlTable | undefined, string][] = [[tableAt(poetry, "dependencies"), "main"], [tableAt(poetry, "dev-dependencies"), "dev"]];
    for (const [group, table] of Object.entries(tableAt(poetry, "group") ?? {})) if (isTable(table)) poetryTables.push([tableAt(table, "dependencies"), group]);
    for (const [table, group] of poetryTables) {
      for (const [dependency, value] of Object.entries(table ?? {})) {
        if (dependency.toLowerCase() === "python") continue;
        const { version, optional } = poetryVersion(value);
        const scope: DependencyScope = group === "main" ? (optional ? "optional" : "production") : "development";
        result.dependencies.push({ name: dependency, version, scope, rawScope: `poetry:${group}` });
      }
    }
  }
  if (uv) { result.signals.uv = true; add(strings(uv["dev-dependencies"]), "development", "tool.uv.dev-dependencies"); }
  const buildSystem = tableAt(doc, "build-system"), backend = buildSystem?.["build-backend"];
  add(strings(buildSystem?.requires), "build", "build-system.requires");
  if (typeof backend === "string") result.signals.buildBackend = backend.slice(0, 80);
  return result;
}

export function parseManifest(type: ManifestType, fileName: string, content: string): ParsedManifest {
  try {
    switch (type) {
      case "package.json": return parsePackageJson(content);
      case "pom.xml": return parsePomXml(content);
      case "build.gradle": case "build.gradle.kts": return parseGradle(content);
      case "requirements.txt": return parseRequirements(content, fileName);
      case "pyproject.toml": return parsePyproject(content);
    }
  } catch (e) {
    return { ...empty(), warnings: [`Could not parse ${fileName}: ${clip(e instanceof Error ? e.message : String(e))}`] };
  }
}
