import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createNexusCatalog, namesOf, StepError, type ToolDefinition } from "./catalog.js";
import { evaluate, resolve, type Scope } from "./template.js";
import { BUILT_IN_WORKFLOWS } from "./templates.js";
import { LIMITS, validateWorkflow, WORKFLOW_ID } from "./validate.js";
import type {
  RunRecord, RunRequest, RunStatus, RunSummary, StepRun, ToolSpec, ValidationIssue, Workflow, WorkflowDefinition, WorkflowInput, WorkflowSummary
} from "./types.js";

export type AgentLabErrorCode =
  | "WORKFLOW_NOT_FOUND" | "RUN_NOT_FOUND" | "INVALID_WORKFLOW" | "INVALID_INPUT" | "CONFIRMATION_REQUIRED" | "READ_ONLY_WORKFLOW" | "INPUTS_NOT_STORED";
export class AgentLabError extends Error {
  readonly code: AgentLabErrorCode;
  readonly details?: { issues?: ValidationIssue[]; sensitiveSteps?: string[] };
  constructor(code: AgentLabErrorCode, message: string, details?: AgentLabError["details"]) {
    super(message); this.name = "AgentLabError"; this.code = code; this.details = details;
  }
}

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.nexus/agent-lab");
const RUN_ID = /^[0-9a-f-]{36}$/;
export type AgentLabOptions = { root?: string; catalog?: ToolDefinition[]; limits?: Partial<typeof LIMITS> };

async function readJson<T>(file: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(file, "utf8")) as T; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw e; }
}
async function writeJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = file + "." + randomUUID().slice(0, 8) + ".tmp";
  await writeFile(temp, JSON.stringify(value, null, 2));
  await rename(temp, file);
}
function timeout<T>(task: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([task, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new StepError(`Step exceeded ${ms / 1000} s`)), ms); })]).finally(() => clearTimeout(timer));
}

/**
 * Deterministic workflow engine: steps run once, in order, with bounded time and size.
 * Workflows and run history live in .nexus/agent-lab (private, Git-ignored).
 */
export class AgentLab {
  private readonly root: string;
  private readonly tools: Map<string, ToolDefinition>;
  private readonly limits: typeof LIMITS;
  constructor(options: AgentLabOptions = {}) {
    this.root = path.resolve(options.root ?? (process.env.NEXUS_AGENT_LAB_DIR || DEFAULT_ROOT));
    this.tools = new Map((options.catalog ?? createNexusCatalog()).map(t => [t.id, t]));
    this.limits = { ...LIMITS, ...options.limits };
  }
  private workflowFile(id: string) { return path.join(this.root, "workflows", `${id}.json`); }
  private runFile(id: string) { return path.join(this.root, "runs", `${id}.json`); }

  listTools(): ToolSpec[] { return [...this.tools.values()].map(({ run: _, ...spec }) => spec); }
  validate(definition: unknown): ValidationIssue[] { return validateWorkflow(definition, this.tools); }

  private summary(workflow: Workflow): WorkflowSummary {
    return {
      id: workflow.id, name: workflow.name, description: workflow.description, builtIn: workflow.builtIn, ...(workflow.updatedAt ? { updatedAt: workflow.updatedAt } : {}),
      inputs: workflow.inputs, stepCount: workflow.steps.length, tools: [...new Set(workflow.steps.map(s => s.tool))],
      sensitive: workflow.steps.some(s => this.tools.get(s.tool)?.sensitive)
    };
  }
  async listWorkflows(): Promise<WorkflowSummary[]> {
    const saved: Workflow[] = [];
    try {
      for (const file of await readdir(path.join(this.root, "workflows"))) {
        if (!file.endsWith(".json")) continue;
        const workflow = await readJson<Workflow>(path.join(this.root, "workflows", file)).catch(() => undefined);
        if (workflow) saved.push(workflow);
      }
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    saved.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
    return [...BUILT_IN_WORKFLOWS.map(w => ({ ...w, builtIn: true })), ...saved].map(w => this.summary(w));
  }
  async getWorkflow(id: string): Promise<Workflow> {
    const builtIn = BUILT_IN_WORKFLOWS.find(w => w.id === id);
    if (builtIn) return { ...structuredClone(builtIn), builtIn: true };
    const workflow = WORKFLOW_ID.test(id) ? await readJson<Workflow>(this.workflowFile(id)) : undefined;
    if (!workflow) throw new AgentLabError("WORKFLOW_NOT_FOUND", `Workflow "${id}" does not exist`);
    return workflow;
  }
  async saveWorkflow(definition: WorkflowDefinition): Promise<Workflow> {
    const issues = this.validate(definition);
    if (issues.length) throw new AgentLabError("INVALID_WORKFLOW", `The workflow has ${issues.length} problem(s)`, { issues });
    if (BUILT_IN_WORKFLOWS.some(w => w.id === definition.id)) throw new AgentLabError("READ_ONLY_WORKFLOW", "Built-in workflows cannot be modified; save a copy under another ID");
    const existing = await readJson<Workflow>(this.workflowFile(definition.id));
    const now = new Date().toISOString();
    const workflow: Workflow = {
      id: definition.id, name: definition.name.trim(), description: (definition.description ?? "").trim(), inputs: definition.inputs, steps: definition.steps,
      builtIn: false, createdAt: existing?.createdAt ?? now, updatedAt: now
    };
    await writeJson(this.workflowFile(workflow.id), workflow);
    return workflow;
  }
  async deleteWorkflow(id: string): Promise<void> {
    const workflow = await this.getWorkflow(id);
    if (workflow.builtIn) throw new AgentLabError("READ_ONLY_WORKFLOW", "Built-in workflows cannot be deleted");
    await rm(this.workflowFile(id), { force: true });
  }

  private coerceInputs(declared: WorkflowInput[], provided: Record<string, unknown> = {}): Record<string, unknown> {
    if (!provided || typeof provided !== "object" || Array.isArray(provided)) throw new AgentLabError("INVALID_INPUT", "Inputs must be an object");
    const result: Record<string, unknown> = {};
    for (const input of declared) {
      const raw = provided[input.name] ?? input.default;
      const empty = raw === undefined || raw === null || raw === "" || (Array.isArray(raw) && !raw.length);
      if (empty) {
        if (input.required) throw new AgentLabError("INVALID_INPUT", `Input "${input.label}" is required`);
        result[input.name] = input.type === "list" ? [] : "";
        continue;
      }
      if (input.type === "number") {
        const value = Number(raw);
        if (!Number.isFinite(value)) throw new AgentLabError("INVALID_INPUT", `Input "${input.label}" must be a number`);
        result[input.name] = value;
      } else if (input.type === "boolean") result[input.name] = raw === true || raw === "true";
      else if (input.type === "list") result[input.name] = namesOf(raw);
      else if (input.type === "project") {
        if (typeof raw !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(raw)) throw new AgentLabError("INVALID_INPUT", `Input "${input.label}" must be a project ID`);
        result[input.name] = raw;
      } else result[input.name] = String(raw);
    }
    return result;
  }

  private cap(value: unknown): { value: unknown; truncated: boolean } {
    const text = JSON.stringify(value) ?? "null";
    return text.length <= this.limits.maxStoredOutputChars ? { value, truncated: false } : { value: { preview: text.slice(0, this.limits.maxStoredOutputChars) + "…" }, truncated: true };
  }

  async run(request: RunRequest & { rerunOf?: string }): Promise<RunRecord> {
    const workflow = await this.getWorkflow(request.workflowId);
    const issues = this.validate(workflow);
    if (issues.length) throw new AgentLabError("INVALID_WORKFLOW", "The workflow is no longer valid", { issues });
    const inputs = this.coerceInputs(workflow.inputs, request.inputs);
    const sensitiveSteps = workflow.steps.filter(s => this.tools.get(s.tool)!.sensitive).map(s => s.label || s.id);
    if (sensitiveSteps.length && request.confirmSensitive !== true) {
      throw new AgentLabError("CONFIRMATION_REQUIRED", `These steps change local data and need explicit confirmation: ${sensitiveSteps.join(", ")}`, { sensitiveSteps });
    }

    const started = Date.now(), deadline = started + this.limits.runTimeoutMs;
    const scope: Scope = { inputs, steps: {} };
    const steps: StepRun[] = [];
    let status: RunStatus = "succeeded", stopped: string | undefined;
    for (const step of workflow.steps) {
      const tool = this.tools.get(step.tool)!, label = step.label || tool.title, at = new Date().toISOString();
      if (stopped) { steps.push({ id: step.id, tool: step.tool, label, status: "skipped", startedAt: at, durationMs: 0, skippedReason: stopped }); continue; }
      if (step.when && !evaluate(step.when, scope)) {
        scope.steps[step.id] = { status: "skipped" };
        steps.push({ id: step.id, tool: step.tool, label, status: "skipped", startedAt: at, durationMs: 0, skippedReason: "condition not met" });
        continue;
      }
      const begin = Date.now();
      let input: Record<string, unknown> = {};
      try {
        if (begin > deadline) throw new StepError(`Run exceeded ${this.limits.runTimeoutMs / 1000} s`);
        input = Object.fromEntries(Object.entries(resolve(step.input, scope) as Record<string, unknown>).filter(([, v]) => v !== undefined));
        for (const param of tool.params) if (param.required && (input[param.name] === undefined || input[param.name] === "")) throw new StepError(`Parameter "${param.name}" resolved to an empty value`);
        const output = await timeout(Promise.resolve().then(() => tool.run(input)), Math.min(this.limits.stepTimeoutMs, Math.max(1, deadline - begin)));
        scope.steps[step.id] = { status: "succeeded", output };
        const storedInput = this.cap(input), storedOutput = this.cap(output);
        steps.push({ id: step.id, tool: step.tool, label, status: "succeeded", startedAt: at, durationMs: Date.now() - begin, input: storedInput.value, output: storedOutput.value, ...(storedInput.truncated || storedOutput.truncated ? { truncated: true } : {}) });
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        scope.steps[step.id] = { status: "failed" };
        const storedInput = this.cap(input);
        steps.push({ id: step.id, tool: step.tool, label, status: "failed", startedAt: at, durationMs: Date.now() - begin, input: storedInput.value, error });
        if (step.continueOnError) status = "completed_with_errors";
        else { status = "failed"; stopped = `step "${label}" failed`; }
      }
    }
    const reportStep = [...workflow.steps].reverse().find(s => s.tool === "core.report" && scope.steps[s.id]?.status === "succeeded");
    const report = reportStep ? String((scope.steps[reportStep.id].output as { markdown?: string })?.markdown ?? "") : undefined;
    const inputsText = JSON.stringify(inputs);
    const inputsStored = inputsText.length <= this.limits.maxStoredInputChars;
    const record: RunRecord = {
      id: randomUUID(), workflowId: workflow.id, workflowName: workflow.name, builtIn: workflow.builtIn, status,
      startedAt: new Date(started).toISOString(), finishedAt: new Date().toISOString(), durationMs: Date.now() - started,
      inputs: inputsStored ? inputs : Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, typeof v === "string" && v.length > 1000 ? `(${v.length} characters, not stored)` : v])),
      inputsStored, confirmedSensitive: sensitiveSteps.length > 0, steps, ...(report ? { report } : {}), ...(request.rerunOf ? { rerunOf: request.rerunOf } : {})
    };
    await writeJson(this.runFile(record.id), record);
    await this.prune();
    return record;
  }

  async rerun(runId: string, confirmSensitive = false): Promise<RunRecord> {
    const previous = await this.getRun(runId);
    if (!previous.inputsStored) throw new AgentLabError("INPUTS_NOT_STORED", "This run's inputs were too large to store; start a new run instead");
    return this.run({ workflowId: previous.workflowId, inputs: previous.inputs, confirmSensitive, rerunOf: runId });
  }
  async getRun(id: string): Promise<RunRecord> {
    const run = RUN_ID.test(id) ? await readJson<RunRecord>(this.runFile(id)) : undefined;
    if (!run) throw new AgentLabError("RUN_NOT_FOUND", `Run "${id}" does not exist`);
    return run;
  }
  private async loadRuns(): Promise<RunRecord[]> {
    let files: string[] = [];
    try { files = (await readdir(path.join(this.root, "runs"))).filter(f => RUN_ID.test(f.replace(/\.json$/, "")) && f.endsWith(".json")); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    const runs = await Promise.all(files.map(f => readJson<RunRecord>(path.join(this.root, "runs", f)).catch(() => undefined)));
    return runs.filter((r): r is RunRecord => !!r).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
  async listRuns(options: { workflowId?: string; limit?: number } = {}): Promise<RunSummary[]> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), this.limits.maxStoredRuns);
    return (await this.loadRuns()).filter(r => !options.workflowId || r.workflowId === options.workflowId).slice(0, limit).map(r => ({
      id: r.id, workflowId: r.workflowId, workflowName: r.workflowName, status: r.status, startedAt: r.startedAt, durationMs: r.durationMs,
      ...(r.rerunOf ? { rerunOf: r.rerunOf } : {}), stepCount: r.steps.length, failedSteps: r.steps.filter(s => s.status === "failed").length
    }));
  }
  async deleteRun(id: string): Promise<void> { await this.getRun(id); await rm(this.runFile(id), { force: true }); }
  private async prune() {
    const runs = await this.loadRuns();
    await Promise.all(runs.slice(this.limits.maxStoredRuns).map(r => rm(this.runFile(r.id), { force: true })));
  }
}
