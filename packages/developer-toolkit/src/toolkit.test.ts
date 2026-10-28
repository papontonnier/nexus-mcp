import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DeveloperToolkit, type ProjectTree, type ProjectFileSearch } from "./index.js";

const FILES: Record<string, string> = {
  "package.json": JSON.stringify({ name: "acme-portal", packageManager: "pnpm@10.0.0", dependencies: { react: "^19.0.0", fastify: "^5.3.0" }, devDependencies: { vite: "^6.2.0", typescript: "^5.8.3" } }),
  "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
  "tsconfig.json": "{}",
  "vite.config.ts": "export default {};\n",
  ".env": "API_TOKEN=do-not-read-this-value\n",
  ".env.example": "API_TOKEN=\n",
  "README.md": "# Acme portal\n",
  ".github/workflows/ci.yml": "on: push\n",
  "src/main.tsx": "export const App = () => null;\n".repeat(40),
  "src/api/server.ts": "export const port = 3001;\n".repeat(10),
  "src/styles/app.css": "body { margin: 0; }\n",
  "backend/pom.xml": "<project><groupId>com.acme</groupId><artifactId>portal-api</artifactId><version>1.0.0</version><dependencies><dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId><version>3.3.0</version></dependency></dependencies></project>",
  "backend/src/main/java/App.java": "class App {}\n".repeat(20),
  "backend/src/main/resources/application.yml": "server:\n  port: 8080\n",
  "scripts/etl.py": "import pandas\n",
  "scripts/requirements.txt": "pandas>=2.0\n",
  "node_modules/react/package.json": "{\"name\":\"react\"}",
  "dist/bundle.js": "console.log(1)",
  ".nexus/knowledge/private.txt": "private"
};

async function fixture(t: TestContext) {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), "nexus-devtools-")));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, "acme");
  for (const [file, content] of Object.entries(FILES)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), content);
  }
  await mkdir(path.join(base, "outside"));
  await writeFile(path.join(base, "outside", "leak.ts"), "export const leaked = true;");
  let linked = true;
  try { await symlink(path.join(base, "outside"), path.join(root, "linked"), "junction"); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "EPERM") throw e; linked = false; }
  const configFile = path.join(base, "projects.json");
  await writeFile(configFile, JSON.stringify({ projects: [{ name: "Acme Portal", path: root }, { id: "gone", name: "Gone", path: path.join(base, "missing") }] }));
  return { base, root, configFile, linked, toolkit: new DeveloperToolkit({ configFile }) };
}
const code = (expected: string) => (error: unknown) => (error as { code?: string }).code === expected;

test("catalog: missing file, invalid JSON and invalid entries", async t => {
  const { base, root } = await fixture(t);
  const none = await new DeveloperToolkit({ configFile: path.join(base, "absent.json") }).listProjects();
  assert.deepEqual([none.configFound, none.projects.length, none.issues.length], [false, 0, 0]);
  await writeFile(path.join(base, "broken.json"), "{ projects: ");
  assert.match((await new DeveloperToolkit({ configFile: path.join(base, "broken.json") }).listProjects()).issues[0], /not valid JSON/);
  await writeFile(path.join(base, "entries.json"), JSON.stringify({ projects: [
    { name: "Acme", path: root }, { name: "Acme", path: root }, { id: "Bad ID", name: "x", path: root },
    { name: "Relative", path: "acme" }, { name: "File", path: path.join(root, "package.json") }, "nope"
  ] }));
  const catalog = await new DeveloperToolkit({ configFile: path.join(base, "entries.json") }).listProjects();
  assert.deepEqual(catalog.projects.map(p => [p.id, p.status]), [["acme", "ready"], ["relative", "invalid"], ["file", "invalid"]]);
  assert.equal(catalog.issues.length, 3);
});

test("catalog is re-read on every call", async t => {
  const { configFile, root, toolkit } = await fixture(t);
  assert.equal((await toolkit.listProjects()).projects.length, 2);
  await writeFile(configFile, JSON.stringify({ projects: [{ id: "renamed", name: "Renamed", path: root }] }));
  assert.deepEqual((await toolkit.listProjects()).projects.map(p => p.id), ["renamed"]);
});

test("inspectProject detects stack, skips excluded directories and never reads secrets", async t => {
  const { toolkit } = await fixture(t);
  const inspection = await toolkit.inspectProject("acme-portal");
  const names = (list: { name: string }[]) => list.map(item => item.name);
  assert.equal(inspection.languages[0].name, "TypeScript");
  for (const language of ["Java", "Python", "CSS"]) assert.ok(names(inspection.languages).includes(language), language);
  for (const framework of ["React", "Fastify", "Spring Boot", "Vite", "pandas"]) assert.ok(names(inspection.frameworks).includes(framework), framework);
  assert.deepEqual(names(inspection.packageManagers).sort(), ["Maven", "pip", "pnpm"]);
  for (const tool of ["Maven", "Vite", "TypeScript compiler"]) assert.ok(names(inspection.buildTools).includes(tool), tool);
  const configs = new Map(inspection.configFiles.map(c => [c.path, c]));
  assert.equal(configs.get(".env")?.sensitive, true);
  assert.equal(configs.get(".env.example")?.sensitive, false);
  assert.equal(configs.get(".github/workflows/ci.yml")?.kind, "CI/CD");
  assert.equal(configs.get("backend/src/main/resources/application.yml")?.kind, "Application");
  assert.deepEqual(inspection.manifests.map(m => m.path), ["package.json", "backend/pom.xml", "scripts/requirements.txt"]);
  assert.deepEqual(inspection.stats.excludedDirectories, [".nexus", "dist", "node_modules"]);
  assert.equal(inspection.stats.files, 16);
  assert.equal(inspection.monorepo, false);
  assert.match(inspection.summary, /^TypeScript project using React, Fastify, Spring Boot and pandas, managed with pnpm/);
  const serialized = JSON.stringify(inspection);
  assert.equal(serialized.includes("do-not-read-this-value"), false);
  assert.equal(serialized.includes("leak.ts"), false);
});

test("analyzeDependencies merges npm, Maven and pip manifests", async t => {
  const { toolkit } = await fixture(t);
  const analysis = await toolkit.analyzeDependencies("acme-portal");
  assert.deepEqual(analysis.summary.byEcosystem, { npm: 4, maven: 1, pypi: 1 });
  assert.deepEqual(analysis.summary.byScope, { production: 4, development: 2 });
  const react = analysis.dependencies.find(d => d.name === "react");
  assert.deepEqual(react, { name: "react", version: "^19.0.0", scope: "production", rawScope: "dependencies", ecosystem: "npm", manifest: "package.json", internal: false });
  assert.equal(analysis.manifests.find(m => m.type === "pom.xml")?.packageName, "com.acme:portal-api");
  assert.ok(analysis.technologies.some(t => t.name === "Spring Boot"));
});

test("getProjectStructure: tree navigation and metadata", async t => {
  const { toolkit, linked } = await fixture(t);
  const top = await toolkit.getProjectStructure("acme-portal", { depth: 1 }) as ProjectTree;
  assert.equal(top.mode, "tree");
  const children = top.root.children!;
  const directories = children.filter(c => c.type === "directory").map(c => c.name);
  assert.deepEqual(directories, [".github", ".nexus", "backend", "dist", "node_modules", "scripts", "src"]);
  assert.equal(children.find(c => c.name === "node_modules")?.excluded, true);
  assert.equal(children.find(c => c.name === ".env")?.sensitive, true);
  assert.equal(children.find(c => c.name === "package.json")?.extension, "json");
  assert.ok(children.every(c => !c.children));
  if (linked) assert.equal(children.find(c => c.name === "linked")?.type, "symlink");
  const src = await toolkit.getProjectStructure("acme-portal", { path: "src", depth: 2 }) as ProjectTree;
  assert.deepEqual(src.root.children!.map(c => c.path), ["src/api", "src/styles", "src/main.tsx"]);
  assert.deepEqual(src.root.children![0].children!.map(c => c.path), ["src/api/server.ts"]);
  assert.ok(src.root.children![2].size! > 0);
});

test("getProjectStructure: search by name, path and extension", async t => {
  const { toolkit } = await fixture(t);
  const search = (options: object) => toolkit.getProjectStructure("acme-portal", options) as Promise<ProjectFileSearch>;
  assert.deepEqual((await search({ query: "server" })).matches.map(m => m.path), ["src/api/server.ts"]);
  assert.deepEqual((await search({ extensions: [".PY"] })).matches.map(m => m.path), ["scripts/etl.py"]);
  assert.deepEqual((await search({ query: "src/api" })).matches.map(m => m.path), ["src/api", "src/api/server.ts"]);
  assert.deepEqual((await search({ query: "react" })).matches, []);
  assert.deepEqual((await search({ query: "leak" })).matches, []);
  const limited = await search({ extensions: ["ts", "tsx"], limit: 1 });
  assert.deepEqual([limited.matches.length, limited.truncated], [1, true]);
  assert.deepEqual((await search({ path: "backend", extensions: ["java"] })).matches.map(m => m.path), ["backend/src/main/java/App.java"]);
});

test("rejects unsafe paths, unknown projects and invalid options", async t => {
  const { toolkit, linked } = await fixture(t);
  const structure = (options: object, id = "acme-portal") => toolkit.getProjectStructure(id, options);
  await assert.rejects(structure({ path: "../" }), code("PATH_OUTSIDE_PROJECT"));
  await assert.rejects(structure({ path: "src/../../outside" }), code("PATH_OUTSIDE_PROJECT"));
  await assert.rejects(structure({ path: "/etc" }), code("INVALID_PATH"));
  await assert.rejects(structure({ path: "node_modules/react" }), code("EXCLUDED_PATH"));
  await assert.rejects(structure({ path: "src/main.tsx" }), code("NOT_A_DIRECTORY"));
  await assert.rejects(structure({ path: "nope" }), code("PATH_NOT_FOUND"));
  if (linked) await assert.rejects(structure({ path: "linked" }), code("PATH_OUTSIDE_PROJECT"));
  await assert.rejects(structure({ depth: 9 }), code("INVALID_INPUT"));
  await assert.rejects(structure({ extensions: ["t$"] }), code("INVALID_INPUT"));
  await assert.rejects(structure({}, "unknown"), code("PROJECT_NOT_FOUND"));
  await assert.rejects(structure({}, "gone"), code("PROJECT_UNAVAILABLE"));
  await assert.rejects(toolkit.inspectProject("../acme"), code("INVALID_INPUT"));
});

test("scan limits mark results as truncated", async t => {
  const { configFile } = await fixture(t);
  const inspection = await new DeveloperToolkit({ configFile, limits: { maxEntries: 5 } }).inspectProject("acme-portal");
  assert.equal(inspection.stats.truncated, true);
  assert.ok(inspection.stats.files + inspection.stats.directories <= 5);
  const shallow = await new DeveloperToolkit({ configFile, limits: { maxDepth: 1 } }).inspectProject("acme-portal");
  assert.equal(shallow.stats.truncated, true);
  assert.ok(!shallow.manifests.some(m => m.path.includes("/")));
});
