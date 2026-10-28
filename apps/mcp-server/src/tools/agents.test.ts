import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AgentLab, createNexusCatalog } from "@nexus/agent-lab";
import { KnowledgeStore } from "@nexus/knowledge-engine";
import { registerAgentTools } from "./agents.js";

async function connect(t: TestContext) {
  const base = await mkdtemp(path.join(tmpdir(), "nexus-mcp-agents-"));
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerAgentTools(server, new AgentLab({ root: path.join(base, "lab"), catalog: createNexusCatalog({ knowledge: new KnowledgeStore(path.join(base, "k")) }) }));
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  t.after(async () => { await client.close(); await server.close(); await rm(base, { recursive: true, force: true }); });
  return client;
}
const call = async (client: Client, name: string, args: Record<string, unknown> = {}) => {
  const result = await client.callTool({ name, arguments: args }) as { isError?: boolean; content: { text: string }[] };
  return { isError: !!result.isError, text: result.content[0].text };
};

test("registers the Agent Lab tools; only run_workflow is not read-only", async t => {
  const client = await connect(t);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => [tool.name, tool.annotations?.readOnlyHint]), [["list_workflows", true], ["run_workflow", false], ["list_workflow_runs", true], ["get_workflow_run", true]]);
});

test("runs a workflow through MCP and requires confirmation for sensitive steps", async t => {
  const client = await connect(t);
  assert.equal(JSON.parse((await call(client, "list_workflows")).text).length, 4);
  const run = JSON.parse((await call(client, "run_workflow", { workflowId: "csv-integration-check", inputs: { csv: "invoice_id,amount\n1,2\n" } })).text);
  assert.equal(run.status, "succeeded");
  assert.equal(JSON.parse((await call(client, "list_workflow_runs")).text)[0].id, run.id);
  assert.match(JSON.parse((await call(client, "get_workflow_run", { runId: run.id })).text).report, /Missing required/);
  const refused = await call(client, "run_workflow", { workflowId: "csv-check-to-knowledge", inputs: { csv: "a\n1\n" } });
  assert.deepEqual([refused.isError, refused.text.startsWith("CONFIRMATION_REQUIRED")], [true, true]);
});
