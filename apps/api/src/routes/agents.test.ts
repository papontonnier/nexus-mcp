import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { AgentLab, createNexusCatalog } from "@nexus/agent-lab";
import { KnowledgeStore } from "@nexus/knowledge-engine";
import { agentRoutes } from "./agents.js";

const CSV = "invoice_id,amount,currency\nINV-1,100,EUR\n";
async function server(t: TestContext) {
  const base = await mkdtemp(path.join(tmpdir(), "nexus-api-agents-"));
  const app = Fastify();
  const lab = new AgentLab({ root: path.join(base, "lab"), catalog: createNexusCatalog({ knowledge: new KnowledgeStore(path.join(base, "knowledge")) }) });
  await app.register(agentRoutes, { prefix: "/api/agents", lab });
  t.after(async () => { await app.close(); await rm(base, { recursive: true, force: true }); });
  return app;
}

test("lists tools and workflows, runs one and reads the history", async t => {
  const app = await server(t);
  const tools = (await app.inject("/api/agents/tools")).json();
  assert.ok(tools.some((tool: { id: string; sensitive: boolean }) => tool.id === "knowledge.import_document" && tool.sensitive));
  assert.equal((await app.inject("/api/agents/workflows")).json().length, 4);
  const run = (await app.inject({ method: "POST", url: "/api/agents/runs", payload: { workflowId: "csv-integration-check", inputs: { csv: CSV } } })).json();
  assert.equal(run.status, "succeeded");
  assert.deepEqual((await app.inject("/api/agents/runs")).json().map((r: { id: string }) => r.id), [run.id]);
  assert.equal((await app.inject(`/api/agents/runs/${run.id}`)).json().report.startsWith("# CSV integration check"), true);
  const replay = (await app.inject({ method: "POST", url: `/api/agents/runs/${run.id}/rerun`, payload: {} })).json();
  assert.equal(replay.rerunOf, run.id);
});

test("saves, validates and deletes user workflows", async t => {
  const app = await server(t);
  const definition = { id: "mine", name: "Mine", description: "", inputs: [], steps: [{ id: "r", tool: "core.report", input: { title: "Hi", template: "x" } }] };
  assert.deepEqual((await app.inject({ method: "POST", url: "/api/agents/workflows/validate", payload: definition })).json(), { issues: [] });
  assert.equal((await app.inject({ method: "PUT", url: "/api/agents/workflows/mine", payload: definition })).statusCode, 200);
  assert.equal((await app.inject({ method: "PUT", url: "/api/agents/workflows/other", payload: definition })).statusCode, 400);
  const invalid = await app.inject({ method: "PUT", url: "/api/agents/workflows/mine", payload: { ...definition, steps: [] } });
  assert.deepEqual([invalid.statusCode, invalid.json().code, invalid.json().issues.length > 0], [400, "INVALID_WORKFLOW", true]);
  assert.equal((await app.inject({ method: "DELETE", url: "/api/agents/workflows/mine" })).json().deleted, true);
});

test("maps engine errors to HTTP statuses", async t => {
  const app = await server(t);
  const confirm = await app.inject({ method: "POST", url: "/api/agents/runs", payload: { workflowId: "csv-check-to-knowledge", inputs: { csv: CSV } } });
  assert.deepEqual([confirm.statusCode, confirm.json().code, confirm.json().sensitiveSteps], [409, "CONFIRMATION_REQUIRED", ["Save report"]]);
  assert.equal((await app.inject({ method: "POST", url: "/api/agents/runs", payload: { workflowId: "csv-check-to-knowledge", inputs: { csv: CSV }, confirmSensitive: true } })).json().status, "succeeded");
  const cases: [string, string, unknown, number, string][] = [
    ["GET", "/api/agents/workflows/nope", undefined, 404, "WORKFLOW_NOT_FOUND"],
    ["DELETE", "/api/agents/workflows/project-audit", undefined, 403, "READ_ONLY_WORKFLOW"],
    ["POST", "/api/agents/runs", { workflowId: "csv-integration-check", inputs: {} }, 400, "INVALID_INPUT"],
    ["GET", "/api/agents/runs/00000000-0000-0000-0000-000000000000", undefined, 404, "RUN_NOT_FOUND"]
  ];
  for (const [method, url, payload, status, code] of cases) {
    const response = await app.inject({ method: method as "GET", url, ...(payload ? { payload: payload as object } : {}) });
    assert.deepEqual([response.statusCode, response.json().code], [status, code], url);
  }
});
