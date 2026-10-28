import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isSensitiveFile, normalizeRelativePath, resolveInside } from "./paths.js";

const code = (pattern: string) => (error: unknown) => (error as { code?: string }).code === pattern;

test("normalizes safe relative paths with either separator", () => {
  assert.equal(normalizeRelativePath(""), "");
  assert.equal(normalizeRelativePath("./src//lib/"), "src/lib");
  assert.equal(normalizeRelativePath("src\\routes\\api"), "src/routes/api");
});

test("rejects traversal, absolute, drive, UNC, stream and excluded paths", () => {
  for (const input of ["..", "../secret", "src/../../etc", "src\\..\\..\\Windows"]) assert.throws(() => normalizeRelativePath(input), code("PATH_OUTSIDE_PROJECT"), input);
  for (const input of ["/etc/passwd", "C:\\Windows", "c:/Users", "C:relative", "\\\\server\\share", "file.txt:stream", "a\x00b"]) {
    assert.throws(() => normalizeRelativePath(input), code("INVALID_PATH"), input);
  }
  for (const input of ["node_modules", "packages/x/node_modules/y", ".git/config", ".nexus/knowledge", "Dist"]) {
    assert.throws(() => normalizeRelativePath(input), code("EXCLUDED_PATH"), input);
  }
});

test("flags secret-bearing files without flagging templates", () => {
  for (const name of [".env", ".env.local", ".envrc", ".npmrc", "server.key", "cert.pem", "id_rsa", "client_secret.json", "aws-credentials", "keystore.jks", "service-account-prod.json"]) {
    assert.equal(isSensitiveFile(name), true, name);
  }
  for (const name of [".env.example", ".env.template", "package.json", "SecretManager.java", "README.md", "id_rsa.pub"]) assert.equal(isSensitiveFile(name), false, name);
});

test("resolveInside rejects symbolic links and junctions that leave the project", async t => {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), "nexus-paths-")));
  try {
    const root = path.join(base, "project"), outside = path.join(base, "outside");
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(outside);
    await writeFile(path.join(outside, "secret.txt"), "top secret");
    try {
      // "junction" needs no elevation on Windows and is ignored elsewhere.
      await symlink(outside, path.join(root, "escape"), "junction");
      await symlink(path.join(root, "src"), path.join(root, "alias"), "junction");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EPERM") return t.skip("symbolic links are not permitted on this machine");
      throw e;
    }
    assert.equal((await resolveInside(root, "src")).absolute, path.join(root, "src"));
    assert.equal((await resolveInside(root, "alias")).absolute, path.join(root, "src"));
    await assert.rejects(resolveInside(root, "escape"), code("PATH_OUTSIDE_PROJECT"));
    await assert.rejects(resolveInside(root, "escape/secret.txt"), code("PATH_OUTSIDE_PROJECT"));
    await assert.rejects(resolveInside(root, "missing"), code("PATH_NOT_FOUND"));
  } finally { await rm(base, { recursive: true, force: true }); }
});
