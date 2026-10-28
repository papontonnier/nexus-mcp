import type { RunRecord, RunSummary, ToolSpec, ValidationIssue, Workflow, WorkflowDefinition, WorkflowSummary } from "@nexus/agent-lab/types";
import type { ProjectCatalog } from "@nexus/developer-toolkit/types";
import { request } from "../../services/http";

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const id = (value: string) => encodeURIComponent(value);

/** Thrown when a run needs explicit approval for steps that change local data. */
export class ConfirmationRequired extends Error { constructor(message: string, readonly steps: string[]) { super(message); } }

export const agentApi = {
  tools: () => request<ToolSpec[]>("/api/agents/tools"),
  workflows: () => request<WorkflowSummary[]>("/api/agents/workflows"),
  workflow: (workflowId: string) => request<Workflow>(`/api/agents/workflows/${id(workflowId)}`),
  validate: (definition: WorkflowDefinition) => request<{ issues: ValidationIssue[] }>("/api/agents/workflows/validate", json("POST", definition)),
  save: (definition: WorkflowDefinition) => request<Workflow>(`/api/agents/workflows/${id(definition.id)}`, json("PUT", definition)),
  remove: (workflowId: string) => request<{ deleted: boolean }>(`/api/agents/workflows/${id(workflowId)}`, { method: "DELETE" }),
  runs: () => request<RunSummary[]>("/api/agents/runs?limit=100"),
  run: (runId: string) => request<RunRecord>(`/api/agents/runs/${id(runId)}`),
  deleteRun: (runId: string) => request<{ deleted: boolean }>(`/api/agents/runs/${id(runId)}`, { method: "DELETE" }),
  projects: () => request<ProjectCatalog>("/api/developer/projects"),
  start: (workflowId: string, inputs: Record<string, unknown>, confirmSensitive: boolean) => confirmable(fetch("/api/agents/runs", json("POST", { workflowId, inputs, confirmSensitive }))),
  rerun: (runId: string, confirmSensitive: boolean) => confirmable(fetch(`/api/agents/runs/${id(runId)}/rerun`, json("POST", { confirmSensitive })))
};

async function confirmable(pending: Promise<Response>): Promise<RunRecord> {
  const response = await pending;
  const data = await response.json().catch(() => null) as (RunRecord & { error?: string; code?: string; sensitiveSteps?: string[] }) | null;
  if (response.status === 409 && data?.code === "CONFIRMATION_REQUIRED") throw new ConfirmationRequired(data.error ?? "Confirmation required", data.sensitiveSteps ?? []);
  if (!response.ok || !data) throw new Error(data?.error ?? `NEXUS API unavailable (${response.status})`);
  return data;
}
