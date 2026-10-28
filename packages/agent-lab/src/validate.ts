import type { ConditionOperator, InputType, ToolSpec, ValidationIssue, WorkflowDefinition } from "./types.js";
import { parsePath, references } from "./template.js";

export const LIMITS = {
  maxSteps: 25, maxInputs: 20, maxDefinitionChars: 200_000, stepTimeoutMs: 60_000, runTimeoutMs: 300_000,
  maxStoredRuns: 200, maxStoredInputChars: 1_000_000, maxStoredOutputChars: 200_000
};
export const WORKFLOW_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const STEP_ID = /^[a-z][a-z0-9_-]{0,39}$/;
const INPUT_NAME = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;
const INPUT_TYPES: InputType[] = ["text", "number", "boolean", "list", "project"];
const OPERATORS: ConditionOperator[] = ["eq", "ne", "gt", "gte", "lt", "lte", "truthy", "falsy", "exists"];
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * Structural checks. Steps may only reference workflow inputs and *earlier* steps, so a workflow is always a
 * finite, acyclic sequence: there are no loops, jumps or recursive calls to express.
 */
export function validateWorkflow(value: unknown, tools: Map<string, ToolSpec>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const issue = (path: string, message: string) => issues.push({ path, message });
  if (!isRecord(value)) return [{ path: "", message: "A workflow must be an object" }];
  if (JSON.stringify(value).length > LIMITS.maxDefinitionChars) issue("", "Workflow definition is too large");
  const def = value as Partial<WorkflowDefinition>;
  if (typeof def.id !== "string" || !WORKFLOW_ID.test(def.id)) issue("id", "Use 1–64 lowercase letters, digits or dashes");
  if (typeof def.name !== "string" || !def.name.trim() || def.name.length > 80) issue("name", "Name must be 1–80 characters");
  if (def.description !== undefined && (typeof def.description !== "string" || def.description.length > 1000)) issue("description", "Description must be at most 1000 characters");

  const inputNames = new Set<string>();
  if (!Array.isArray(def.inputs)) issue("inputs", "Inputs must be a list");
  else {
    if (def.inputs.length > LIMITS.maxInputs) issue("inputs", `At most ${LIMITS.maxInputs} inputs`);
    def.inputs.forEach((input, i) => {
      const path = `inputs[${i}]`;
      if (!isRecord(input)) return issue(path, "Input must be an object");
      if (typeof input.name !== "string" || !INPUT_NAME.test(input.name)) issue(`${path}.name`, "Input names start with a letter and use letters, digits or _");
      else if (inputNames.has(input.name)) issue(`${path}.name`, `Duplicate input "${input.name}"`);
      else inputNames.add(input.name);
      if (typeof input.label !== "string" || !input.label.trim() || input.label.length > 80) issue(`${path}.label`, "Label must be 1–80 characters");
      if (!INPUT_TYPES.includes(input.type as InputType)) issue(`${path}.type`, `Type must be one of ${INPUT_TYPES.join(", ")}`);
      if (typeof input.required !== "boolean") issue(`${path}.required`, "required must be true or false");
    });
  }

  const stepIds = new Set<string>();
  if (!Array.isArray(def.steps) || !def.steps.length) issue("steps", "Add at least one step");
  else {
    if (def.steps.length > LIMITS.maxSteps) issue("steps", `At most ${LIMITS.maxSteps} steps`);
    def.steps.forEach((step, i) => {
      const path = `steps[${i}]`;
      if (!isRecord(step)) return issue(path, "Step must be an object");
      const tool = typeof step.tool === "string" ? tools.get(step.tool) : undefined;
      if (typeof step.id !== "string" || !STEP_ID.test(step.id)) issue(`${path}.id`, "Step IDs start with a letter and use lowercase letters, digits, _ or -");
      else if (stepIds.has(step.id)) issue(`${path}.id`, `Duplicate step "${step.id}"`);
      if (!tool) issue(`${path}.tool`, `Unknown tool "${String(step.tool)}"`);
      if (step.label !== undefined && (typeof step.label !== "string" || step.label.length > 80)) issue(`${path}.label`, "Label must be at most 80 characters");
      if (!isRecord(step.input)) issue(`${path}.input`, "Step input must be an object");
      else if (tool) {
        for (const key of Object.keys(step.input)) if (!tool.params.some(p => p.name === key)) issue(`${path}.input.${key}`, `"${tool.id}" has no parameter "${key}"`);
        for (const param of tool.params) if (param.required && (step.input[param.name] === undefined || step.input[param.name] === "")) issue(`${path}.input.${param.name}`, `Required parameter "${param.name}" is missing`);
      }
      const refs = references(step.input ?? {});
      if (step.when !== undefined) {
        if (!isRecord(step.when) || typeof step.when.ref !== "string") issue(`${path}.when`, "A condition needs a ref");
        else {
          if (!OPERATORS.includes(step.when.op as ConditionOperator)) issue(`${path}.when.op`, `Operator must be one of ${OPERATORS.join(", ")}`);
          refs.push(step.when.ref.replace(/^\{\{\s*|\s*\}\}$/g, ""));
        }
      }
      for (const ref of refs) {
        let segments: string[];
        try { segments = parsePath(ref); } catch (e) { issue(`${path}`, (e as Error).message); continue; }
        if (segments[0] === "inputs") { if (!inputNames.has(segments[1])) issue(path, `Reference to unknown input "${ref}"`); }
        else if (segments[0] === "steps") {
          if (!stepIds.has(segments[1])) issue(path, `"${ref}" must refer to an earlier step`);
          else if (segments[2] !== "output" && segments[2] !== "status") issue(path, `"${ref}": use steps.<id>.output… or steps.<id>.status`);
        } else issue(path, `"${ref}" must start with inputs. or steps.`);
      }
      if (typeof step.id === "string") stepIds.add(step.id);
    });
  }
  return issues;
}
