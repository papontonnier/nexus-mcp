import React from "react";
import { ArrowRight, Copy, History, Pencil, Play, Plus, ShieldAlert, Trash2, Workflow as WorkflowIcon } from "lucide-react";
import type { RunRecord, RunSummary, ToolSpec, WorkflowDefinition, WorkflowSummary } from "@nexus/agent-lab/types";
import { errorMessage, formatDate } from "../../services/format";
import { agentApi, ConfirmationRequired } from "./api";
import RunDetail, { STATUS_LABELS } from "./RunDetail";
import RunPanel from "./RunPanel";
import WorkflowBuilder from "./WorkflowBuilder";
import "./agents.css";

type Tab = "workflows" | "history";
const BLANK: WorkflowDefinition = { id: "", name: "", description: "", inputs: [], steps: [{ id: "report", tool: "core.report", input: { title: "Report", template: "" } }] };

export default function AgentWorkspace() {
  const [tools, setTools] = React.useState<ToolSpec[]>([]);
  const [workflows, setWorkflows] = React.useState<WorkflowSummary[]>([]);
  const [runs, setRuns] = React.useState<RunSummary[]>([]);
  const [tab, setTab] = React.useState<Tab>("workflows");
  const [selected, setSelected] = React.useState<WorkflowSummary | null>(null);
  const [editing, setEditing] = React.useState<WorkflowDefinition | null>(null);
  const [run, setRun] = React.useState<RunRecord | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const toolTitles = new Map(tools.map(t => [t.id, t.title]));

  const refresh = React.useCallback(async () => {
    const [toolList, workflowList, runList] = await Promise.all([agentApi.tools(), agentApi.workflows(), agentApi.runs()]);
    setTools(toolList); setWorkflows(workflowList); setRuns(runList);
  }, []);
  React.useEffect(() => { refresh().catch(e => setError(errorMessage(e))); }, [refresh]);

  async function edit(summary: WorkflowSummary, copy: boolean) {
    try {
      const { builtIn: _, createdAt: __, updatedAt: ___, ...definition } = await agentApi.workflow(summary.id);
      setEditing(copy ? { ...definition, id: `${definition.id}-copy`.slice(0, 64), name: `${definition.name} (copy)` } : definition);
      setSelected(null); setRun(null);
    } catch (e) { setError(errorMessage(e)); }
  }
  async function remove(summary: WorkflowSummary) {
    if (!window.confirm(`Delete the workflow "${summary.name}"? Its run history is kept.`)) return;
    try { await agentApi.remove(summary.id); if (selected?.id === summary.id) setSelected(null); await refresh(); }
    catch (e) { setError(errorMessage(e)); }
  }
  async function openRun(id: string) {
    try { setRun(await agentApi.run(id)); setTab("history"); } catch (e) { setError(errorMessage(e)); }
  }
  async function rerun(record: RunRecord) {
    setBusy(true); setError("");
    try {
      // Ask first when the original run already needed approval, instead of waiting for a refusal.
      if (record.confirmedSensitive && !window.confirm("This workflow changes local data (it writes into the knowledge base). Run it again?")) return;
      let confirm = record.confirmedSensitive;
      for (;;) {
        try { setRun(await agentApi.rerun(record.id, confirm)); break; }
        catch (e) {
          if (!(e instanceof ConfirmationRequired) || confirm || !window.confirm(`${e.message}\n\nRun anyway?`)) throw e;
          confirm = true;
        }
      }
      await refresh();
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  const finished = async (record: RunRecord) => { setRun(record); await refresh(); };

  const succeeded = runs.filter(r => r.status === "succeeded").length;
  return <div className="agents-page">
    <div className="eyebrow">AUTOMATION / AGENT LAB</div>
    <div className="hero-row"><div><h1>Agent Lab<span className="accent">.</span></h1><p className="lead">Chain NEXUS tools into deterministic workflows. Every run is bounded, recorded and replayable.</p></div><span className="version-pill">● Agent Lab v0.8</span></div>
    <div className="agent-stats">
      <div><strong>{workflows.length}</strong><span>Workflows · {workflows.filter(w => !w.builtIn).length} yours</span></div>
      <div><strong>{runs.length}</strong><span>Recorded runs · {succeeded} succeeded</span></div>
      <div><strong>{tools.length}</strong><span>Tools · no AI model involved</span></div>
    </div>
    {error && <div className="error-box agent-error" role="alert">{error}</div>}

    {editing ? <div className="workspace-panel">
      <div className="panel-heading"><div><h2>{editing.name || "New workflow"}</h2><p>Steps run once, in order. A step may only use workflow inputs and earlier steps.</p></div></div>
      <WorkflowBuilder initial={editing} tools={tools} onCancel={() => setEditing(null)} onSaved={async id => { setEditing(null); await refresh(); setSelected((await agentApi.workflows()).find(w => w.id === id) ?? null); }} />
    </div> : <>
      <div className="workspace-panel">
        <div className="panel-heading"><div><h2>{tab === "workflows" ? "Workflow catalogue" : "Run history"}</h2><p>{tab === "workflows" ? "Built-in workflows are read-only: duplicate them to customize." : "The last 200 runs are kept locally in .nexus/agent-lab."}</p></div>
          {tab === "workflows" && <button className="primary-button agent-with-icon" onClick={() => { setEditing(BLANK); setSelected(null); }}><Plus size={15} /> New workflow</button>}</div>
        <div className="tool-tabs" role="tablist" aria-label="Agent Lab views">
          <button role="tab" aria-selected={tab === "workflows"} className={tab === "workflows" ? "tool-tab active" : "tool-tab"} onClick={() => setTab("workflows")}><WorkflowIcon size={15} />Workflows</button>
          <button role="tab" aria-selected={tab === "history"} className={tab === "history" ? "tool-tab active" : "tool-tab"} onClick={() => setTab("history")}><History size={15} />History</button>
        </div>
        {tab === "workflows" ? <div className="agent-grid">{workflows.map(w => <article key={w.id} className={"agent-card" + (selected?.id === w.id ? " selected" : "")}>
          <div className="agent-card-top"><span className={"chip" + (w.builtIn ? "" : " active")}>{w.builtIn ? "Built-in" : "Yours"}</span>{w.sensitive && <span className="agent-sensitive"><ShieldAlert size={13} /> Writes data</span>}</div>
          <h3>{w.name}</h3><p>{w.description}</p>
          <div className="agent-pipeline" aria-label={`${w.stepCount} steps`}>{w.tools.map((tool, i) => <React.Fragment key={tool}>{i > 0 && <ArrowRight size={12} />}<span>{toolTitles.get(tool) ?? tool}</span></React.Fragment>)}</div>
          <div className="agent-card-actions">
            <button className="primary-button agent-with-icon" onClick={() => { setSelected(w); setRun(null); }}><Play size={14} /> Run</button>
            <button className="secondary-button agent-icon-button" aria-label={`Duplicate ${w.name}`} title="Duplicate" onClick={() => void edit(w, true)}><Copy size={14} /></button>
            {!w.builtIn && <button className="secondary-button agent-icon-button" aria-label={`Edit ${w.name}`} title="Edit" onClick={() => void edit(w, false)}><Pencil size={14} /></button>}
            {!w.builtIn && <button className="secondary-button agent-icon-button danger" aria-label={`Delete ${w.name}`} title="Delete" onClick={() => void remove(w)}><Trash2 size={14} /></button>}
          </div>
        </article>)}</div>
        : runs.length ? <div className="data-table-scroll"><table className="data-table agent-table">
          <thead><tr><th>Workflow</th><th>Status</th><th>Started</th><th className="agent-col-duration">Duration</th><th className="agent-col-steps">Steps</th></tr></thead>
          <tbody>{runs.map(r => <tr key={r.id} className={run?.id === r.id ? "selected" : ""}>
            <td><button className="agent-link" onClick={() => void openRun(r.id)}>{r.workflowName}</button>{r.rerunOf && <small className="agent-muted"> · re-run</small>}</td>
            <td><span className={"agent-status " + r.status}>{STATUS_LABELS[r.status]}</span></td>
            <td>{formatDate(r.startedAt)} {new Date(r.startedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</td>
            <td className="agent-col-duration">{r.durationMs} ms</td><td className="agent-col-steps">{r.stepCount}{r.failedSteps ? ` · ${r.failedSteps} failed` : ""}</td>
          </tr>)}</tbody>
        </table></div> : <div className="result-empty">No run yet. Start one from the catalogue.</div>}
      </div>

      {selected && tab === "workflows" && <div className="workspace-panel">
        <div className="panel-heading"><div><h2>Run “{selected.name}”</h2><p>{selected.stepCount} steps · inputs are stored with the run so it can be replayed (up to 1 MB).</p></div></div>
        <RunPanel key={selected.id} workflow={selected} onDone={record => void finished(record)} />
      </div>}
      {run && <div className="workspace-panel"><RunDetail run={run} busy={busy} onRerun={() => void rerun(run)} /></div>}
    </>}
  </div>;
}
