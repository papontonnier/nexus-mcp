import React from "react";
import { Play, ShieldAlert } from "lucide-react";
import type { RunRecord, WorkflowInput, WorkflowSummary } from "@nexus/agent-lab/types";
import type { DevProject } from "@nexus/developer-toolkit/types";
import { errorMessage } from "../../services/format";
import { agentApi, ConfirmationRequired } from "./api";

const initial = (input: WorkflowInput) => Array.isArray(input.default) ? input.default.join(", ") : input.default === undefined ? "" : String(input.default);

export default function RunPanel({ workflow, onDone }: { workflow: WorkflowSummary; onDone: (run: RunRecord) => void }) {
  const [values, setValues] = React.useState<Record<string, string | boolean>>(() => Object.fromEntries(workflow.inputs.map(i => [i.name, i.type === "boolean" ? i.default === true : initial(i)])));
  const [projects, setProjects] = React.useState<DevProject[]>([]);
  const [confirm, setConfirm] = React.useState(false);
  const [pending, setPending] = React.useState<string[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  React.useEffect(() => {
    if (workflow.inputs.some(i => i.type === "project")) agentApi.projects().then(c => setProjects(c.projects.filter(p => p.status === "ready"))).catch(() => setProjects([]));
  }, [workflow]);

  async function start() {
    setBusy(true); setError("");
    try { onDone(await agentApi.start(workflow.id, values, confirm)); setPending(null); }
    catch (e) { if (e instanceof ConfirmationRequired) setPending(e.steps); else setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  const set = (name: string, value: string | boolean) => setValues(v => ({ ...v, [name]: value }));
  return <div className="agent-run-panel">
    <div className="agent-form">{workflow.inputs.map(input => <label key={input.name} className={input.multiline ? "wide" : ""}>
      <span>{input.label}{input.required && <em> required</em>}</span>
      {input.type === "text" && input.multiline ? <textarea rows={5} value={String(values[input.name])} onChange={e => set(input.name, e.target.value)} placeholder={input.description} spellCheck={false} />
        : input.type === "boolean" ? <input type="checkbox" checked={values[input.name] === true} onChange={e => set(input.name, e.target.checked)} />
        : input.type === "project" ? <select value={String(values[input.name])} onChange={e => set(input.name, e.target.value)}>
            <option value="">{projects.length ? "Choose a project…" : "No allowed project (see Developer Toolkit)"}</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        : <input type={input.type === "number" ? "number" : "text"} value={String(values[input.name])} onChange={e => set(input.name, e.target.value)} placeholder={input.type === "list" ? "Comma-separated values" : input.description} />}
    </label>)}</div>
    {(workflow.sensitive || pending) && <label className="agent-confirm"><ShieldAlert size={16} /><input type="checkbox" checked={confirm} onChange={e => setConfirm(e.target.checked)} />
      <span>I confirm the steps that change local data{pending?.length ? `: ${pending.join(", ")}` : " (they write into the knowledge base)"}.</span></label>}
    {error && <div className="error-box" role="alert">{error}</div>}
    <div className="agent-actions"><button className="primary-button agent-with-icon" disabled={busy || ((workflow.sensitive || !!pending) && !confirm)} onClick={() => void start()}><Play size={15} /> {busy ? "Running…" : "Run workflow"}</button></div>
  </div>;
}
