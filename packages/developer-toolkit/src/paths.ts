import { realpath } from "node:fs/promises";
import path from "node:path";
import { DeveloperToolkitError } from "./errors.js";

// Generated, vendored, VCS or private directories: never listed in depth, never entered.
export const EXCLUDED_DIRECTORIES = [
  "node_modules", ".git", "dist", "build", "target", "coverage", ".next", ".venv",
  "venv", ".nexus", ".idea", ".gradle", ".svn", ".hg", "__pycache__", ".pytest_cache", ".mypy_cache",
  ".ruff_cache", ".tox", ".turbo", ".cache", ".parcel-cache", ".nuxt", ".svelte-kit", "out", "bower_components"
];
const excluded = new Set(EXCLUDED_DIRECTORIES);
export const isExcludedDirectory = (name: string) => excluded.has(name.toLowerCase());

// Files whose contents are never read. Names stay visible so the owner knows they exist.
const SENSITIVE_PATTERNS = [
  /^\.env(?:rc|\..+)?$/i,/^\.(?:npmrc|pypirc|netrc|pgpass|git-credentials|htpasswd)$/i,
  /\.(?:pem|key|p12|pfx|jks|keystore|kdbx|ppk|ovpn)$/i, /^id_(?:rsa|dsa|ecdsa|ed25519)$/i,
  /(?:^|[._-])(?:secrets?|credentials?)(?:[._-]|$)/i, /^service[-_]?account.*\.json$/i
];
const TEMPLATE = /^\.env\.(?:example|sample|template|dist|defaults)$/i;
export function isSensitiveFile(name: string): boolean {
  return !TEMPLATE.test(name) && SENSITIVE_PATTERNS.some(pattern => pattern.test(name));
}

export function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative));
}

/** Validates a client-supplied path and returns it as "a/b/c" relative to the project root ("" = root). */
export function normalizeRelativePath(input: string): string {
  if (input.length > 1024 || /[\x00-\x1f]/.test(input)) throw new DeveloperToolkitError("INVALID_PATH", "Invalid path");
  if (path.posix.isAbsolute(input) || path.win32.isAbsolute(input) || /^[A-Za-z]:/.test(input)) {
    throw new DeveloperToolkitError("INVALID_PATH", "Use a path relative to the project root");
  }
  const segments = input.split(/[\\/]+/).filter(segment => segment && segment !== ".");
  for (const segment of segments) {
    if (segment === "..") throw new DeveloperToolkitError("PATH_OUTSIDE_PROJECT", "Parent directory segments are not allowed");
    if (segment.includes(":")) throw new DeveloperToolkitError("INVALID_PATH", "Invalid path segment");
    if (isExcludedDirectory(segment)) throw new DeveloperToolkitError("EXCLUDED_PATH", `"${segment}" is excluded from exploration`);
  }
  return segments.join("/");
}

/** Resolves a relative path inside a project root, following symbolic links only if they stay inside the root. */
export async function resolveInside(root: string, input: string): Promise<{ absolute: string; relative: string }> {
  const relative = normalizeRelativePath(input);
  let absolute: string;
  try { absolute = await realpath(path.join(root, ...relative.split("/"))); }
  catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") throw new DeveloperToolkitError("PATH_NOT_FOUND", "Path not found in project");
    throw e;
  }
  if (!isInside(root, absolute)) throw new DeveloperToolkitError("PATH_OUTSIDE_PROJECT", "Path resolves outside the project root");
  return { absolute, relative };
}

export const extensionOf = (name: string) => {
  const index = name.lastIndexOf(".");
  return index > 0 && index < name.length - 1 ? name.slice(index + 1).toLowerCase() : "";
};
