import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";

test("built stdio server exposes every NEXUS tool", async t => {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), "nexus-mcp-stdio-")));
  const configFile = path.join(base, "projects.json");
  await writeFile(configFile, JSON.stringify({ projects: [{ name: "Fixture", path: base }] }));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(path.dirname(fileURLToPath(import.meta.url)), "index.js")],
    env: { ...getDefaultEnvironment(), NEXUS_DEV_PROJECTS_FILE: configFile, NEXUS_KNOWLEDGE_DIR: path.join(base, "knowledge") },
    stderr: "pipe"
  });
  const client = new Client({ name: "stdio-smoke-test", version: "0.0.0" });
  t.after(async () => { await client.close(); await rm(base, { recursive: true, force: true }); });
  await client.connect(transport);
  assert.equal(client.getServerVersion()?.version, "0.6.0");
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name).sort(), [
    "analyze_csv", "analyze_data_structure", "analyze_dependencies", "compare_json_schemas", "get_document", "get_project_structure",
    "import_knowledge_document", "inspect_project", "list_developer_projects", "list_knowledge_sources", "search_knowledge"
  ]);
  const result = await client.callTool({ name: "list_developer_projects", arguments: {} }) as { content: { text: string }[] };
  assert.equal(JSON.parse(result.content[0].text).projects[0].id, "fixture");
});
