import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DevProject, ProjectCatalog } from "./types.js";

// Same repository-local convention as the Knowledge Engine: .nexus/ is private and ignored by Git.
export const DEFAULT_CONFIG_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.nexus/developer/projects.json");
export const PROJECT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_CONFIG_BYTES = 256_000;
const MAX_PROJECTS = 50;

export function slugify(name: string): string {
  return name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+/, "").slice(0, 64).replace(/-+$/, "");
}

async function toProject(entry: unknown, label: string, seen: Set<string>, issues: string[]): Promise<DevProject | null> {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) { issues.push(`${label}: expected an object`); return null; }
  const { id, name, path: configured, description } = entry as Record<string, unknown>;
  if (typeof name !== "string" || !name.trim() || name.length > 80 || /[\x00-\x1f]/.test(name)) {
    issues.push(`${label}: "name" must be 1–80 characters`); return null;
  }
  const projectId = id === undefined ? slugify(name) : id;
  if (typeof projectId !== "string" || !PROJECT_ID.test(projectId)) {
    issues.push(`${label}: "id" must contain 1–64 lowercase letters, digits or dashes`); return null;
  }
  if (seen.has(projectId)) { issues.push(`${label}: duplicate id "${projectId}"`); return null; }
  seen.add(projectId);
  const project: DevProject = { id: projectId, name: name.trim(), path: typeof configured === "string" ? configured : "", status: "ready" };
  if (typeof description === "string" && description.trim()) project.description = description.trim().slice(0, 200);
  if (typeof configured !== "string" || !path.isAbsolute(configured)) return { ...project, status: "invalid", issue: '"path" must be an absolute directory path' };
  try {
    const real = await realpath(configured);
    if (!(await stat(real)).isDirectory()) return { ...project, path: real, status: "invalid", issue: "Path is not a directory" };
    if (path.parse(real).root === real) return { ...project, path: real, status: "invalid", issue: "Filesystem roots cannot be registered" };
    return { ...project, path: real };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return { ...project, status: "missing", issue: "Directory not found" };
    return { ...project, status: "invalid", issue: `Directory cannot be accessed (${code ?? "unknown error"})` };
  }
}

/** Reads the owner-maintained allowlist. Only the owner edits this file: neither the API nor MCP can add projects. */
export async function loadCatalog(configFile: string): Promise<ProjectCatalog> {
  const catalog: ProjectCatalog = { configFile, configFound: false, projects: [], issues: [] };
  let raw: string;
  try {
    if ((await stat(configFile)).size > MAX_CONFIG_BYTES) {
      catalog.configFound = true; catalog.issues.push("Configuration file exceeds 256 KB"); return catalog;
    }
    raw = await readFile(configFile, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return catalog;
    throw e;
  }
  catalog.configFound = true;
  let parsed: unknown;
  try { parsed = JSON.parse(raw.replace(/^﻿/, "")); }
  catch (e) { catalog.issues.push("Configuration is not valid JSON: " + (e as Error).message); return catalog; }
  const entries = parsed && typeof parsed === "object" && "projects" in parsed && Array.isArray(parsed.projects) ? parsed.projects as unknown[] : null;
  if (!entries) { catalog.issues.push('Expected an object with a "projects" array'); return catalog; }
  if (entries.length > MAX_PROJECTS) catalog.issues.push(`Only the first ${MAX_PROJECTS} projects are loaded`);
  const seen = new Set<string>();
  for (const [index, entry] of entries.slice(0, MAX_PROJECTS).entries()) {
    const project = await toProject(entry, `Project #${index + 1}`, seen, catalog.issues);
    if (project) catalog.projects.push(project);
  }
  return catalog;
}
