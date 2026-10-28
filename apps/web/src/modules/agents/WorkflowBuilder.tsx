import React from "react";
import { ArrowDown, ArrowUp, CircleAlert, Plus, Save, ShieldAlert, Trash2 } from "lucide-react";
import type { ConditionOperator, InputType, ToolParam, ToolSpec, ValidationIssue, WorkflowDefinition, WorkflowInput, WorkflowStep } from "@nexus/agent-lab/types";
import { errorMessage } from "../../services/format";
import { agentApi } from "./api";

const INPUT_TYPES: InputType[] = ["text", "number", "boolean", "list", "project"];
const OPERATORS: ConditionOperator[] = ["eq", "ne", "gt", "gte", "lt", "lte", "truthy", "falsy", "exists"];
const display = (value: unknown) => value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);

/** Converts what the user typed into the parameter's type, keeping {{references}} as text. */
function parseParam(text: string, param: ToolParam): unknown {
  if (text === "" ) return undefined;
  if (text.includes("{{")) return text;
  if (param.type === "number") { const n = Number(text); return Number.isFinite(n) ? n : text; }
  if (param.type === "boolean") return text === "true" ? true : text === "false" ? false : text;
  if (param.type === "string[]") return text.split(",").map(v => v.trim()).filter(Boolean);
  if (param.type === "json") { try { return JSON.parse(text); } catch { return text; } }
  return text;
}

export default function WorkflowBuilder({ initial, tools, onSaved, onCancel }: { initial: WorkflowDefinition; tools: ToolSpec[]; onSaved: (id: string) => void; onCancel: () => void }) {
  const [draft, setDraft] = React.useState<WorkflowDefinition>(initial);
  const [issues, setIssues] = React.useState<ValidationIssue[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const toolMap = new Map(tools.map(t => [t.id, t]));
  const modules = [...new Set(tools.map(t => t.module))];

  React.useEffect(() => {
    const timer = window.setTimeout(() => { agentApi.validate(draft).then(r => setIssues(r.issues)).catch(() => undefined); }, 350);
    return () => window.clearTimeout(timer);
  }, [draft]);

  const setInput = (i: number, patch: Partial<WorkflowInput>) => setDraft(d => ({ ...d, inputs: d.inputs.map((input, j) => j === i ? { ...input, ...patch } : input) }));
  const setStep = (i: number, patch: Partial<WorkflowStep>) => setDraft(d => ({ ...d, steps: d.steps.map((step, j) => j === i ? { ...step, ...patch } : step) }));
  const move = (i: number, delta: number) => setDraft(d => { const steps = [...d.steps]; const [step] = steps.splice(i, 1); steps.splice(i + delta, 0, step); return { ...d, steps }; });
  function setParam(i: number, param: ToolParam, text: string) {
    setDraft(d => ({ ...d, steps: d.steps.map((step, j) => {
      if (j !== i) return step;
      const input = { ...step.input }, value = parseParam(text, param);
      if (value === undefined) delete input[param.name]; else input[param.name] = value;
      return { ...step, input };
    }) }));
  }
  async function save() {
    setBusy(true); setError("");
    try { const saved = await agentApi.save(draft); onSaved(saved.id); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  const stepIssues = (i: number) => issues.filter(issue => issue.path === `steps[${i}]` || issue.path.startsWith(`steps[${i}].`));

  return <div className="agent-builder">
    <div className="agent-form">
      <label><span>Workflow ID</span><input value={draft.id} onChange={e => setDraft(d => ({ ...d, id: e.target.value.toLowerCase() }))} placeholder="my-workflow" /></label>
      <label><span>Name</span><input value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} /></label>
      <label className="wide"><span>Description</span><input value={draft.description} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))} /></label>
    </div>

    <h4 className="agent-subheading">Inputs</h4>
    <div className="agent-rows">{draft.inputs.map((input, i) => <div key={i} className="agent-row">
      <input aria-label="Input name" value={input.name} onChange={e => setInput(i, { name: e.target.value })} placeholder="name" />
      <input aria-label="Input label" value={input.label} onChange={e => setInput(i, { label: e.target.value })} placeholder="Label" />
      <select aria-label="Input type" value={input.type} onChange={e => setInput(i, { type: e.target.value as InputType })}>{INPUT_TYPES.map(t => <option key={t}>{t}</option>)}</select>
      <label className="agent-check"><input type="checkbox" checked={input.required} onChange={e => setInput(i, { required: e.target.checked })} /> required</label>
      {input.type === "text" && <label className="agent-check"><input type="checkbox" checked={!!input.multiline} onChange={e => setInput(i, { multiline: e.target.checked || undefined })} /> multi-line</label>}
      <button className="secondary-button agent-icon-button" aria-label={`Remove input ${input.name}`} onClick={() => setDraft(d => ({ ...d, inputs: d.inputs.filter((_, j) => j !== i) }))}><Trash2 size={14} /></button>
    </div>)}</div>
    <button className="secondary-button agent-with-icon" onClick={() => setDraft(d => ({ ...d, inputs: [...d.inputs, { name: `input${d.inputs.length + 1}`, label: "New input", type: "text", required: true }] }))}><Plus size={14} /> Add input</button>

    <h4 className="agent-subheading">Steps</h4>
    <ol className="agent-builder-steps">{draft.steps.map((step, i) => {
      const tool = toolMap.get(step.tool);
      const refs = [...draft.inputs.map(input => `{{inputs.${input.name}}}`), ...draft.steps.slice(0, i).map(s => `{{steps.${s.id}.output}}`)];
      return <li key={i} className={"agent-builder-step" + (stepIssues(i).length ? " invalid" : "")}>
        <div className="agent-row">
          <span className="agent-step-number">{i + 1}</span>
          <input aria-label="Step ID" value={step.id} onChange={e => setStep(i, { id: e.target.value })} placeholder="step_id" />
          <select aria-label="Tool" value={step.tool} onChange={e => setStep(i, { tool: e.target.value, input: {} })}>
            {modules.map(m => <optgroup key={m} label={m}>{tools.filter(t => t.module === m).map(t => <option key={t.id} value={t.id}>{t.title}{t.sensitive ? " (sensitive)" : ""}</option>)}</optgroup>)}
          </select>
          <input aria-label="Step label" value={step.label ?? ""} onChange={e => setStep(i, { label: e.target.value || undefined })} placeholder="Label (optional)" />
          <button className="secondary-button agent-icon-button" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={14} /></button>
          <button className="secondary-button agent-icon-button" aria-label="Move down" disabled={i === draft.steps.length - 1} onClick={() => move(i, 1)}><ArrowDown size={14} /></button>
          <button className="secondary-button agent-icon-button" aria-label={`Remove step ${step.id}`} onClick={() => setDraft(d => ({ ...d, steps: d.steps.filter((_, j) => j !== i) }))}><Trash2 size={14} /></button>
        </div>
        {tool && <p className="agent-muted">{tool.sensitive && <><ShieldAlert size={13} /> Changes local data — runs need confirmation. </>}{tool.description}</p>}
        <div className="agent-params">{tool?.params.map(param => <label key={param.name} className={param.type === "json" || param.name === "template" || param.name === "content" ? "wide" : ""}>
          <span>{param.name}{param.required && <em> required</em>} <small>{param.type} · {param.description}</small></span>
          {param.type === "json" || param.name === "template"
            ? <textarea rows={param.name === "template" ? 5 : 2} value={display(step.input[param.name])} onChange={e => setParam(i, param, e.target.value)} spellCheck={false} />
            : <input value={display(step.input[param.name])} onChange={e => setParam(i, param, e.target.value)} />}
        </label>)}</div>
        <div className="agent-step-options">
          <label className="agent-check"><input type="checkbox" checked={!!step.continueOnError} onChange={e => setStep(i, { continueOnError: e.target.checked || undefined })} /> Continue if this step fails</label>
          <label className="agent-check"><input type="checkbox" checked={!!step.when} onChange={e => setStep(i, { when: e.target.checked ? { ref: refs[0]?.replace(/[{}]/g, "") ?? "inputs.x", op: "truthy" } : undefined })} /> Run only if…</label>
          {step.when && <>
            <input aria-label="Condition reference" value={step.when.ref} onChange={e => setStep(i, { when: { ...step.when!, ref: e.target.value } })} placeholder="steps.check.output.ok" />
            <select aria-label="Condition operator" value={step.when.op} onChange={e => setStep(i, { when: { ...step.when!, op: e.target.value as ConditionOperator } })}>{OPERATORS.map(o => <option key={o}>{o}</option>)}</select>
            {!["truthy", "falsy", "exists"].includes(step.when.op) && <input aria-label="Condition value" value={display(step.when.value)} onChange={e => setStep(i, { when: { ...step.when!, value: e.target.value } })} placeholder="value" />}
          </>}
        </div>
        {refs.length > 0 && <p className="agent-refs"><span>Available</span>{refs.map(ref => <code key={ref}>{ref}</code>)}</p>}
        {stepIssues(i).map((issue, j) => <p key={j} className="agent-issue"><CircleAlert size={13} /> {issue.message}</p>)}
      </li>;
    })}</ol>
    <button className="secondary-button agent-with-icon" onClick={() => setDraft(d => ({ ...d, steps: [...d.steps, { id: `step${d.steps.length + 1}`, tool: "core.report", input: {} }] }))}><Plus size={14} /> Add step</button>

    {issues.filter(issue => !issue.path.startsWith("steps[")).map((issue, i) => <p key={i} className="agent-issue"><CircleAlert size={13} /> {issue.path ? `${issue.path}: ` : ""}{issue.message}</p>)}
    {error && <div className="error-box" role="alert">{error}</div>}
    <div className="agent-actions">
      <button className="secondary-button" onClick={onCancel}>Cancel</button>
      <button className="primary-button agent-with-icon" disabled={busy || issues.length > 0} onClick={() => void save()}><Save size={15} /> {issues.length ? `${issues.length} problem${issues.length === 1 ? "" : "s"} to fix` : busy ? "Saving…" : "Save workflow"}</button>
    </div>
  </div>;
}
