import React from "react";
import { CheckCircle2, CircleDashed, RotateCcw, XCircle } from "lucide-react";
import type { RunRecord, StepRun } from "@nexus/agent-lab/types";
import { formatDate } from "../../services/format";

export const STATUS_LABELS: Record<string, string> = { succeeded: "Succeeded", failed: "Failed", completed_with_errors: "Completed with errors", skipped: "Skipped" };
const STEP_ICONS = { succeeded: CheckCircle2, failed: XCircle, skipped: CircleDashed };
const preview = (value: unknown) => { const text = typeof value === "string" ? value : JSON.stringify(value, null, 2); return text.length > 20_000 ? text.slice(0, 20_000) + "\n…" : text; };
const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** Minimal Markdown rendering for generated reports: headings, paragraphs, list items and JSON blocks. */
function Report({ markdown }: { markdown: string }) {
  const blocks: React.ReactNode[] = [];
  let list: string[] = [], code: string[] = [];
  const flushList = () => { if (list.length) blocks.push(<ul key={blocks.length}>{list.map((item, i) => <li key={i}>{item}</li>)}</ul>); list = []; };
  const flushCode = () => { if (code.length) blocks.push(<pre key={blocks.length}>{code.join("\n")}</pre>); code = []; };
  for (const line of markdown.split("\n")) {
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) { flushList(); flushCode(); blocks.push(React.createElement(`h${heading[1].length + 2}`, { key: blocks.length }, heading[2])); }
    else if (/^\s*[[\]{}]/.test(line) || /^\s{2,}\S/.test(line)) { flushList(); code.push(line); }
    else if (/^[-*]\s+/.test(line)) { flushCode(); list.push(line.replace(/^[-*]\s+/, "")); }
    else if (!line.trim()) { flushList(); flushCode(); }
    else { flushList(); flushCode(); blocks.push(<p key={blocks.length}>{line}</p>); }
  }
  flushList(); flushCode();
  return <div className="agent-report">{blocks}</div>;
}

function StepItem({ step, index }: { step: StepRun; index: number }) {
  const Icon = STEP_ICONS[step.status];
  return <li className={"agent-step " + step.status}>
    <span className="agent-step-icon" aria-hidden="true"><Icon size={17} /></span>
    <details open={step.status === "failed"}>
      <summary>
        <span className="agent-step-title"><small>{index + 1}</small><strong>{step.label}</strong><code>{step.tool}</code></span>
        <span className="agent-step-meta">{STATUS_LABELS[step.status]}{step.status !== "skipped" && ` · ${step.durationMs} ms`}</span>
      </summary>
      {step.error && <div className="error-box">{step.error}</div>}
      {step.skippedReason && <p className="agent-muted">Skipped: {step.skippedReason}</p>}
      {step.truncated && <p className="agent-muted">Large values were truncated in the stored history.</p>}
      {step.input !== undefined && <><h5>Input</h5><pre className="agent-json">{preview(step.input)}</pre></>}
      {step.output !== undefined && <><h5>Output</h5><pre className="agent-json">{preview(step.output)}</pre></>}
    </details>
  </li>;
}

export default function RunDetail({ run, onRerun, busy }: { run: RunRecord; onRerun?: () => void; busy?: boolean }) {
  return <div className="agent-run">
    <div className="agent-run-header">
      <div><span className={"agent-status " + run.status}>{STATUS_LABELS[run.status]}</span><h3>{run.workflowName}</h3>
        <p>{formatDate(run.startedAt)} {time(run.startedAt)} · {run.durationMs} ms{run.rerunOf ? " · re-run" : ""}{run.confirmedSensitive ? " · sensitive steps confirmed" : ""}</p></div>
      {onRerun && <button className="secondary-button agent-with-icon" disabled={busy || !run.inputsStored} title={run.inputsStored ? "Run again with the same inputs" : "Inputs were too large to store"} onClick={onRerun}><RotateCcw size={14} /> Re-run</button>}
    </div>
    <ol className="agent-timeline">{run.steps.map((step, i) => <StepItem key={step.id} step={step} index={i} />)}</ol>
    {run.report && <><h4 className="agent-subheading">Report</h4><Report markdown={run.report} /></>}
  </div>;
}
