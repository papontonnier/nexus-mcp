import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { KnowledgeStore } from "@nexus/knowledge-engine";
import { AgentLab, AgentLabError, BUILT_IN_WORKFLOWS, createNexusCatalog, type ToolDefinition, type WorkflowDefinition } from "./index.js";
import { resolve } from "./template.js";

const CSV = "invoice_id,amount,currency,customer\nINV-1,100,EUR,ACME\nINV-2,250,EUR,Globex\n";
async function lab(t: TestContext, options: { extraTools?: ToolDefinition[]; limits?: Record<string, number> } = {}) {
  const base = await mkdtemp(path.join(tmpdir(), "nexus-agents-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const knowledge = new KnowledgeStore(path.join(base, "knowledge"));
  const catalog = [...createNexusCatalog({ knowledge }), ...(options.extraTools ?? [])];
  return { lab: new AgentLab({ root: path.join(base, "lab"), catalog, limits: options.limits }), knowledge };
}
const code = (expected: string) => (e: unknown) => e instanceof AgentLabError && e.code === expected;
const workflow = (steps: WorkflowDefinition["steps"], inputs: WorkflowDefinition["inputs"] = []): WorkflowDefinition => ({ id: "test-flow", name: "Test flow", description: "", inputs, steps });

test("references keep types, interpolate text and refuse prototype keys", () => {
  const scope = { inputs: { n: 3, list: ["a", "b"] }, steps: { s: { status: "succeeded", output: { rows: [{ name: "x" }] } } } };
  assert.equal(resolve("{{inputs.n}}", scope), 3);
  assert.deepEqual(resolve({ value: "{{ steps.s.output.rows[0].name }}" }, scope), { value: "x" });
  assert.equal(resolve("Rows: {{steps.s.output.rows[0].name}} / {{inputs.n}}", scope), "Rows: x / 3");
  assert.equal(resolve("{{inputs.missing}}", scope), undefined);
  assert.throws(() => resolve("{{inputs.__proto__}}", scope), /Invalid reference/);
  assert.throws(() => resolve("{{steps.s.constructor}}", scope), /Invalid reference/);
});

test("validation rejects forward references, unknown tools and parameters", async t => {
  const { lab: agents } = await lab(t);
  const issues = agents.validate(workflow([
    { id: "a", tool: "core.report", input: { title: "x", template: "{{steps.b.output.markdown}}" } },
    { id: "b", tool: "core.nope", input: {} },
    { id: "a", tool: "core.report", input: { title: "x", template: "y", extra: 1 } },
    { id: "c", tool: "integration.analyze_csv", input: { csv: "{{inputs.unknown}}" } },
    { id: "d", tool: "core.report", input: { template: "x" }, when: { ref: "inputs.x.y", op: "exists" } }
  ]));
  const messages = issues.map(i => i.message).join(" | ");
  for (const fragment of ["must refer to an earlier step", "Unknown tool", "Duplicate step", "has no parameter", "unknown input", "Required parameter \"title\""]) assert.ok(messages.includes(fragment), fragment);
  assert.match(agents.validate({ ...workflow([]), steps: Array.from({ length: 26 }, (_, i) => ({ id: `s${i}`, tool: "core.report", input: { title: "t", template: "x" } })) }).map(i => i.message).join(), /At most 25 steps/);
  for (const builtIn of BUILT_IN_WORKFLOWS) assert.deepEqual(agents.validate(builtIn), [], builtIn.id);
});

test("runs the CSV integration check end to end with a report", async t => {
  const { lab: agents } = await lab(t);
  const run = await agents.run({ workflowId: "csv-integration-check", inputs: { csv: CSV, requiredColumns: "invoice_id, amount, status" } });
  assert.equal(run.status, "succeeded");
  assert.deepEqual(run.steps.map(s => [s.id, s.status]), [["analyze", "succeeded"], ["check", "succeeded"], ["compare", "succeeded"], ["report", "succeeded"]]);
  assert.deepEqual((run.steps[1].output as { missing: string[] }).missing, ["status"]);
  assert.match(run.report!, /^# CSV integration check\n\n- Rows: 2\n- Required columns present: false\n- Missing required: status\n- Target coverage: 60%\n- Missing in source: status, due_date\n- Extra in source: customer\n/);
  assert.deepEqual((await agents.listRuns()).map(r => [r.id, r.status]), [[run.id, "succeeded"]]);
});

test("sensitive steps need explicit confirmation", async t => {
  const { lab: agents, knowledge } = await lab(t);
  await assert.rejects(agents.run({ workflowId: "csv-check-to-knowledge", inputs: { csv: CSV } }), (e: unknown) => code("CONFIRMATION_REQUIRED")(e) && (e as AgentLabError).details!.sensitiveSteps![0] === "Save report");
  assert.equal((await knowledge.list()).length, 0);
  const run = await agents.run({ workflowId: "csv-check-to-knowledge", inputs: { csv: CSV }, confirmSensitive: true });
  assert.deepEqual([run.status, run.confirmedSensitive], ["succeeded", true]);
  const [document] = await knowledge.list();
  assert.equal(document.name, "csv-check.md");
  assert.match((await knowledge.get(document.id)).content, /# CSV check/);
});

test("a failed step stops the run unless continueOnError is set; conditions skip steps", async t => {
  const { lab: agents } = await lab(t);
  const steps: WorkflowDefinition["steps"] = [
    { id: "gate", tool: "core.assert", input: { value: "{{inputs.count}}", op: "gt", expected: 5, message: "Not enough rows" } },
    { id: "big", tool: "core.report", input: { title: "Big", template: "x" }, when: { ref: "inputs.count", op: "gte", value: 100 } },
    { id: "after", tool: "core.report", input: { title: "After", template: "{{steps.gate.status}}" } }
  ];
  await agents.saveWorkflow(workflow(steps, [{ name: "count", label: "Count", type: "number", required: true }]));
  const failed = await agents.run({ workflowId: "test-flow", inputs: { count: 2 } });
  assert.equal(failed.status, "failed");
  assert.deepEqual(failed.steps.map(s => [s.status, s.error ?? s.skippedReason]), [["failed", "Not enough rows"], ["skipped", 'step "Assert a condition" failed'], ["skipped", 'step "Assert a condition" failed']]);
  await agents.saveWorkflow(workflow([{ ...steps[0], continueOnError: true }, steps[1], steps[2]], [{ name: "count", label: "Count", type: "number", required: true }]));
  const partial = await agents.run({ workflowId: "test-flow", inputs: { count: "3" } });
  assert.equal(partial.status, "completed_with_errors");
  assert.deepEqual(partial.steps.map(s => s.status), ["failed", "skipped", "succeeded"]);
  assert.equal(partial.report, "# After\n\nfailed\n");
  await assert.rejects(agents.run({ workflowId: "test-flow", inputs: { count: "many" } }), code("INVALID_INPUT"));
  await assert.rejects(agents.run({ workflowId: "test-flow", inputs: {} }), code("INVALID_INPUT"));
});

test("slow steps time out", async t => {
  const slow: ToolDefinition = { id: "test.slow", module: "Test", title: "Slow", description: "", sensitive: false, params: [], run: () => new Promise(r => setTimeout(r, 500)) };
  const { lab: agents } = await lab(t, { extraTools: [slow], limits: { stepTimeoutMs: 30 } });
  await agents.saveWorkflow(workflow([{ id: "wait", tool: "test.slow", input: {} }]));
  const run = await agents.run({ workflowId: "test-flow" });
  assert.deepEqual([run.status, run.steps[0].error], ["failed", "Step exceeded 0.03 s"]);
});

test("workflows are stored, built-ins are read-only, runs can be replayed and are pruned", async t => {
  const { lab: agents } = await lab(t, { limits: { maxStoredRuns: 2 } });
  await assert.rejects(agents.saveWorkflow({ ...BUILT_IN_WORKFLOWS[0] }), code("READ_ONLY_WORKFLOW"));
  await assert.rejects(agents.deleteWorkflow("project-audit"), code("READ_ONLY_WORKFLOW"));
  await assert.rejects(agents.saveWorkflow(workflow([])), (e: unknown) => code("INVALID_WORKFLOW")(e) && !!(e as AgentLabError).details?.issues?.length);
  const saved = await agents.saveWorkflow({ ...BUILT_IN_WORKFLOWS[0], id: "my-check", name: "My check" });
  const list = await agents.listWorkflows();
  assert.deepEqual(list.map(w => [w.id, w.builtIn]).slice(-1), [["my-check", false]]);
  assert.equal(list.find(w => w.id === "csv-check-to-knowledge")!.sensitive, true);
  assert.equal((await agents.getWorkflow("my-check")).createdAt, saved.createdAt);
  const first = await agents.run({ workflowId: "my-check", inputs: { csv: CSV } });
  const replay = await agents.rerun(first.id);
  assert.deepEqual([replay.rerunOf, replay.inputs.csv, replay.status], [first.id, CSV, "succeeded"]);
  await agents.run({ workflowId: "my-check", inputs: { csv: CSV } });
  assert.equal((await agents.listRuns()).length, 2);
  await assert.rejects(agents.getRun(first.id), code("RUN_NOT_FOUND"));
  await agents.deleteWorkflow("my-check");
  await assert.rejects(agents.getWorkflow("my-check"), code("WORKFLOW_NOT_FOUND"));
  await assert.rejects(agents.getRun("../../etc/passwd"), code("RUN_NOT_FOUND"));
});

test("the finance review stops at the gate when blocking errors remain", async t => {
  const { lab: agents } = await lab(t);
  const run = await agents.run({ workflowId: "finance-dataset-review", inputs: { dataset: "Entity;Account;Period;Amount;Currency\nFR01;6061;2026-01;12,50;EUR\nFR01;6061;2026-02;abc;EUR\n" } });
  assert.equal(run.status, "failed");
  assert.deepEqual(run.steps.map(s => s.status), ["succeeded", "succeeded", "succeeded", "succeeded", "failed"]);
  assert.equal(run.steps[4].error, "The dataset still contains blocking errors");
  assert.match(run.report!, /- Errors: 1/);
});
