// Public contracts shared by the API, the MCP server and (type-only) the web app.
// Keep this file free of runtime imports so browsers can consume it.

export type ParamType = "string" | "number" | "boolean" | "string[]" | "json";
export type ToolParam = { name: string; type: ParamType; required: boolean; description: string };
/** A NEXUS capability usable as a workflow step. Sensitive tools change local data and need explicit confirmation. */
export type ToolSpec = { id: string; module: string; title: string; description: string; sensitive: boolean; params: ToolParam[] };

export type InputType = "text" | "number" | "boolean" | "list" | "project";
export type WorkflowInput = { name: string; label: string; type: InputType; required: boolean; multiline?: boolean; description?: string; default?: string | number | boolean | string[] };
export type ConditionOperator = "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "truthy" | "falsy" | "exists";
/** `ref` is a reference such as "steps.analyze.output.summary.errors" or "inputs.threshold". */
export type Condition = { ref: string; op: ConditionOperator; value?: string | number | boolean | null };
/**
 * Step inputs are JSON values. Strings may reference earlier data with {{inputs.x}} or {{steps.id.output.path}}.
 * A string made of a single reference keeps the referenced value's type (object, number…).
 */
export type WorkflowStep = { id: string; tool: string; label?: string; input: Record<string, unknown>; when?: Condition; continueOnError?: boolean };
export type WorkflowDefinition = { id: string; name: string; description: string; inputs: WorkflowInput[]; steps: WorkflowStep[] };
export type WorkflowSummary = {
  id: string; name: string; description: string; builtIn: boolean; updatedAt?: string;
  inputs: WorkflowInput[]; stepCount: number; tools: string[]; sensitive: boolean;
};
export type Workflow = WorkflowDefinition & { builtIn: boolean; createdAt?: string; updatedAt?: string };
export type ValidationIssue = { path: string; message: string };

export type StepStatus = "succeeded" | "failed" | "skipped";
export type RunStatus = "succeeded" | "failed" | "completed_with_errors";
export type StepRun = {
  id: string; tool: string; label: string; status: StepStatus; startedAt: string; durationMs: number;
  input?: unknown; output?: unknown; error?: string; skippedReason?: string; truncated?: boolean;
};
export type RunRecord = {
  id: string; workflowId: string; workflowName: string; builtIn: boolean; status: RunStatus;
  startedAt: string; finishedAt: string; durationMs: number;
  inputs: Record<string, unknown>; inputsStored: boolean; confirmedSensitive: boolean;
  steps: StepRun[]; report?: string; rerunOf?: string;
};
export type RunSummary = Pick<RunRecord, "id" | "workflowId" | "workflowName" | "status" | "startedAt" | "durationMs" | "rerunOf"> & { stepCount: number; failedSteps: number };
export type RunRequest = { workflowId: string; inputs?: Record<string, unknown>; confirmSensitive?: boolean };
