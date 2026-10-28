import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DeveloperToolkit } from "@nexus/developer-toolkit";
import { registerDeveloperTools } from "./developer.js";

async function connect(t: TestContext) {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), "nexus-mcp-dev-")));
  const root = path.join(base, "service");
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "requirements.txt"), "fastapi>=0.110\npytest>=8\n");
  await writeFile(path.join(root, "src", "main.py"), "print('ok')\n");
  const configFile = path.join(base, "projects.json");
  await writeFile(configFile, JSON.stringify({ projects: [{ id: "svc", name: "Service", path: root }] }));
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerDeveloperTools(server, new DeveloperToolkit({ configFile }));
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  t.after(async () => { await client.close(); await server.close(); await rm(base, { recursive: true, force: true }); });
  return client;
}
type ToolResult = { isError?: boolean; content: { type: string; text: string }[] };
const call = async (client: Client, name: string, args: Record<string, unknown> = {}) => {
  const result = await client.callTool({ name, arguments: args }) as ToolResult;
  return { isError: !!result.isError, text: result.content[0].text };
};

test("registers four read-only developer tools", async t => {
  const client = await connect(t);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name), ["list_developer_projects", "inspect_project", "analyze_dependencies", "get_project_structure"]);
  for (const tool of tools) assert.deepEqual([tool.annotations?.readOnlyHint, tool.annotations?.openWorldHint], [true, false], tool.name);
  const structure = tools.find(tool => tool.name === "get_project_structure")!;
  assert.deepEqual(structure.inputSchema.required, ["projectId"]);
});

test("tools return the shared engine's results", async t => {
  const client = await connect(t);
  assert.equal(JSON.parse((await call(client, "list_developer_projects")).text).projects[0].id, "svc");
  assert.equal(JSON.parse((await call(client, "inspect_project", { projectId: "svc" })).text).languages[0].name, "Python");
  const dependencies = JSON.parse((await call(client, "analyze_dependencies", { projectId: "svc" })).text);
  assert.deepEqual(dependencies.dependencies.map((d: { name: string }) => d.name), ["fastapi", "pytest"]);
  const search = JSON.parse((await call(client, "get_project_structure", { projectId: "svc", extensions: ["py"] })).text);
  assert.deepEqual(search.matches.map((m: { path: string }) => m.path), ["src/main.py"]);
});

test("tools report errors without escaping the project", async t => {
  const client = await connect(t);
  const outside = await call(client, "get_project_structure", { projectId: "svc", path: "../.." });
  assert.deepEqual([outside.isError, outside.text], [true, "PATH_OUTSIDE_PROJECT: Parent directory segments are not allowed"]);
  const unknown = await call(client, "inspect_project", { projectId: "other" });
  assert.match(unknown.text, /^PROJECT_NOT_FOUND/);
  const invalid = await call(client, "inspect_project", { projectId: "../etc" });
  assert.equal(invalid.isError, true);
});
