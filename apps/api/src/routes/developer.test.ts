import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { DeveloperToolkit } from "@nexus/developer-toolkit";
import { developerRoutes } from "./developer.js";

async function server(t: TestContext) {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), "nexus-api-dev-")));
  const root = path.join(base, "demo");
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "node_modules", "fastify"), { recursive: true });
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "demo", dependencies: { fastify: "^5.3.0" }, devDependencies: { typescript: "^5.8.3" } }));
  await writeFile(path.join(root, "src", "index.ts"), "export {};\n");
  await writeFile(path.join(root, ".env"), "TOKEN=never-returned\n");
  const configFile = path.join(base, "projects.json");
  await writeFile(configFile, JSON.stringify({ projects: [{ name: "Demo", path: root }, { name: "Missing", path: path.join(base, "missing") }] }));
  const app = Fastify();
  await app.register(developerRoutes, { prefix: "/api/developer", toolkit: new DeveloperToolkit({ configFile }) });
  t.after(async () => { await app.close(); await rm(base, { recursive: true, force: true }); });
  return app;
}

test("lists configured projects with their status", async t => {
  const app = await server(t);
  const response = await app.inject("/api/developer/projects");
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().projects.map((p: { id: string; status: string }) => [p.id, p.status]), [["demo", "ready"], ["missing", "missing"]]);
});

test("inspects a project and analyzes its dependencies", async t => {
  const app = await server(t);
  const inspection = await app.inject("/api/developer/projects/demo/inspect");
  assert.equal(inspection.statusCode, 200);
  assert.equal(inspection.json().languages[0].name, "TypeScript");
  assert.equal(inspection.body.includes("never-returned"), false);
  const dependencies = await app.inject("/api/developer/projects/demo/dependencies");
  assert.deepEqual(dependencies.json().summary.byScope, { production: 1, development: 1 });
});

test("returns trees and searches through the structure endpoint", async t => {
  const app = await server(t);
  const tree = (await app.inject("/api/developer/projects/demo/structure?depth=1")).json();
  assert.equal(tree.mode, "tree");
  assert.equal(tree.root.children.find((c: { name: string }) => c.name === "node_modules").excluded, true);
  const search = (await app.inject("/api/developer/projects/demo/structure?ext=ts,%20json&limit=10")).json();
  assert.deepEqual(search.matches.map((m: { path: string }) => m.path), ["package.json", "src/index.ts"]);
});

test("maps toolkit and validation errors to HTTP statuses", async t => {
  const app = await server(t);
  const cases: [string, number, string][] = [
    ["/api/developer/projects/unknown/inspect", 404, "PROJECT_NOT_FOUND"],
    ["/api/developer/projects/missing/dependencies", 409, "PROJECT_UNAVAILABLE"],
    ["/api/developer/projects/demo/structure?path=..%2F..", 403, "PATH_OUTSIDE_PROJECT"],
    ["/api/developer/projects/demo/structure?path=node_modules", 403, "EXCLUDED_PATH"],
    ["/api/developer/projects/demo/structure?path=%2Fetc", 400, "INVALID_PATH"],
    ["/api/developer/projects/demo/structure?path=src%2Findex.ts", 400, "NOT_A_DIRECTORY"],
    ["/api/developer/projects/demo/structure?path=nowhere", 404, "PATH_NOT_FOUND"],
    ["/api/developer/projects/demo/structure?depth=12", 400, "INVALID_INPUT"],
    ["/api/developer/projects/demo/structure?ext=%2E%2E%2F", 400, "INVALID_INPUT"],
    ["/api/developer/projects/Bad..ID/inspect", 400, "INVALID_INPUT"]
  ];
  for (const [url, status, code] of cases) {
    const response = await app.inject(url);
    assert.equal(response.statusCode, status, url);
    assert.equal(response.json().code, code, url);
    assert.equal(typeof response.json().error, "string", url);
  }
});
