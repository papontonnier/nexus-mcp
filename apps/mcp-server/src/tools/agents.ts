import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AgentLab, AgentLabError } from "@nexus/agent-lab";

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

async function run(task: () => Promise<unknown>) {
  try { return { content: [{ type: "text" as const, text: JSON.stringify(await task(), null, 2) }] }; }
  catch (e) {
    const text = e instanceof AgentLabError ? `${e.code}: ${e.message}` : String(e);
    return { isError: true, content: [{ type: "text" as const, text }] };
  }
}

export function registerAgentTools(server: McpServer, lab: AgentLab) {
  server.registerTool("list_workflows", {
    title: "List workflows",
    description: "List Agent Lab workflows (built-in and saved) with their inputs, tools, and whether they contain sensitive steps that change local data.",
    annotations: readOnly
  }, async () => run(() => lab.listWorkflows()));

  server.registerTool("run_workflow", {
    title: "Run workflow",
    description: "Run a deterministic NEXUS workflow once, step by step, and record it in the run history. Workflows with sensitive steps (for example saving into the knowledge base) only run when confirmSensitive is true: ask the user before setting it.",
    inputSchema: {
      workflowId: z.string().max(64),
      inputs: z.record(z.unknown()).optional().describe("Values for the workflow inputs, by input name"),
      confirmSensitive: z.boolean().optional().describe("Explicit approval for steps that change local data")
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }, async ({ workflowId, inputs, confirmSensitive }) => run(() => lab.run({ workflowId, inputs, confirmSensitive })));

  server.registerTool("list_workflow_runs", {
    title: "List workflow runs",
    description: "Recent workflow runs with status, duration and failed step count.",
    inputSchema: { workflowId: z.string().max(64).optional(), limit: z.number().int().min(1).max(200).optional() },
    annotations: readOnly
  }, async options => run(() => lab.listRuns(options)));

  server.registerTool("get_workflow_run", {
    title: "Get workflow run",
    description: "Full record of a run: inputs, each step's input, output or error, and the generated report.",
    inputSchema: { runId: z.string().max(64) },
    annotations: readOnly
  }, async ({ runId }) => run(() => lab.getRun(runId)));
}
