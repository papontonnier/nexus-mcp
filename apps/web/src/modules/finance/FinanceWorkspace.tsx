import React from "react";
import { FileSpreadsheet, GitMerge, ListChecks, ShieldCheck, Sparkles, UploadCloud } from "lucide-react";
import type { DatasetAnalysis, DatasetInput } from "@nexus/finance-solutions/types";
import { CodeEditor } from "../../IntegrationResults";
import { errorMessage, formatNumber } from "../../services/format";
import { financeApi, readTextFile } from "./api";
import DimensionsView from "./DimensionsView";
import MappingView from "./MappingView";
import QualityView from "./QualityView";
import { SAMPLE_DATASET } from "./sample";
import "./finance.css";

type Tab = "quality" | "dimensions" | "mapping";
const TABS: { id: Tab; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: "quality", label: "Data quality", icon: ListChecks }, { id: "dimensions", label: "Dimensions", icon: ShieldCheck }, { id: "mapping", label: "Mapping", icon: GitMerge }
];
const LARGE = 200_000;
const DELIMITERS = [["", "Auto"], [",", "Comma ,"], [";", "Semicolon ;"], ["\t", "Tab"], ["|", "Pipe |"]];

export default function FinanceWorkspace() {
  const [content, setContent] = React.useState("");
  const [fileName, setFileName] = React.useState("");
  const [delimiter, setDelimiter] = React.useState("");
  const [decimal, setDecimal] = React.useState<"auto" | "." | ",">("auto");
  const [dataset, setDataset] = React.useState<DatasetInput | null>(null);
  const [analysis, setAnalysis] = React.useState<DatasetAnalysis | null>(null);
  const [tab, setTab] = React.useState<Tab>("quality");
  const [run, setRun] = React.useState(0);
  const [visited, setVisited] = React.useState<Set<Tab>>(new Set(["quality"]));
  const open = (id: Tab) => { setTab(id); setVisited(v => new Set(v).add(id)); };
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const fileRef = React.useRef<HTMLInputElement>(null);

  async function analyze(text = content) {
    setBusy(true); setError("");
    const input: DatasetInput = { content: text, ...(delimiter ? { delimiter } : {}), decimalSeparator: decimal };
    try {
      const result = await financeApi.analyze(input);
      // A new dataset object resets the dimension and mapping views.
      setDataset(input); setAnalysis(result); setTab("quality"); setVisited(new Set(["quality"])); setRun(n => n + 1);
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  async function load(file: File) {
    setError("");
    try {
      if (file.size > 5_000_000) throw new Error("Files are limited to 5 MB.");
      const text = await readTextFile(file);
      setContent(text); setFileName(file.name);
      await analyze(text);
    } catch (e) { setError(errorMessage(e)); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  }

  const lines = content ? content.split("\n").length : 0;
  return <div className="finance-page">
    <div className="eyebrow">FINANCIAL DATA / FINANCE SOLUTIONS</div>
    <div className="hero-row"><div><h1>Finance Solutions<span className="accent">.</span></h1><p className="lead">Check financial datasets and prepare integration mappings. Processed in memory, never stored.</p></div><span className="version-pill">● Finance v0.7</span></div>
    <div className="fin-stats">
      <div><strong>{analysis ? formatNumber(analysis.rowCount) : "—"}</strong><span>{analysis ? `Rows · ${analysis.columnCount} columns` : "Rows"}</span></div>
      <div><strong className={analysis?.summary.errors ? "fin-count-error" : ""}>{analysis ? analysis.summary.errors : "—"}</strong><span>Errors</span></div>
      <div><strong>{analysis ? analysis.summary.warnings : "—"}</strong><span>Warnings</span></div>
    </div>

    <div className="workspace-panel">
      <div className="panel-heading"><div><h2>Dataset</h2><p>CSV with a header row, or a JSON array of objects. Up to 5 MB and 100,000 rows.</p></div>
        <div className="fin-actions inline">
          <button className="secondary-button fin-with-icon" onClick={() => { setContent(SAMPLE_DATASET); setFileName("sample-gl.csv"); void analyze(SAMPLE_DATASET); }} disabled={busy}><Sparkles size={14} /> Sample</button>
          <button className="primary-button fin-primary" onClick={() => fileRef.current?.click()} disabled={busy}><UploadCloud size={15} /> Import file</button>
        </div></div>
      <input ref={fileRef} type="file" hidden accept=".csv,.txt,.json,text/csv,application/json" onChange={e => { const file = e.target.files?.[0]; if (file) void load(file); }} />
      <div className="editor-label"><label htmlFor="data-input">{fileName ? <><FileSpreadsheet size={13} /> {fileName}</> : "Paste data"}</label><span>{lines ? `${formatNumber(lines)} lines` : "or import a file"}</span></div>
      {content.length <= LARGE
        ? <CodeEditor label="Financial dataset" language={/^\s*[[{]/.test(content) ? "json" : "csv"} value={content} onChange={value => { setContent(value); setFileName(""); }} />
        : <div className="result-empty fin-large"><FileSpreadsheet size={17} /> Large dataset loaded ({formatNumber(content.length)} characters). The editor is hidden to keep the page responsive. <button className="secondary-button" onClick={() => { setContent(""); setFileName(""); }}>Clear</button></div>}
      <div className="editor-footer">
        <label className="fin-option">Delimiter<select value={delimiter} onChange={e => setDelimiter(e.target.value)}>{DELIMITERS.map(([value, label]) => <option key={label} value={value}>{label}</option>)}</select></label>
        <label className="fin-option">Decimal<select value={decimal} onChange={e => setDecimal(e.target.value as "auto" | "." | ",")}><option value="auto">Auto</option><option value=",">Comma 1 250,50</option><option value=".">Point 1,250.50</option></select></label>
        <span className="hint">{analysis ? `Detected: ${analysis.format.toUpperCase()}${analysis.delimiter ? ` · "${analysis.delimiter === "\t" ? "tab" : analysis.delimiter}"` : ""} · decimal "${analysis.decimalSeparator}"` : "Processed locally via NEXUS API"}</span>
        <button className="primary-button" disabled={busy || !content.trim()} onClick={() => void analyze()}>{busy ? "Analyzing…" : "Analyze"} <span>↗</span></button>
      </div>
      {error && <div className="error-box fin-error" role="alert">{error}</div>}
    </div>

    {analysis && dataset && <div className="workspace-panel">
      <div className="tool-tabs" role="tablist" aria-label="Finance views">{TABS.map(t => <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "tool-tab active" : "tool-tab"} onClick={() => open(t.id)}><t.icon size={15} />{t.label}</button>)}</div>
      {/* Visited views stay mounted (hidden) so rules and mapping choices survive tab switches. */}
      <div hidden={tab !== "quality"}><QualityView analysis={analysis} /></div>
      {visited.has("dimensions") && <div hidden={tab !== "dimensions"}><DimensionsView key={run} dataset={dataset} analysis={analysis} /></div>}
      {visited.has("mapping") && <div hidden={tab !== "mapping"}><MappingView key={run} dataset={dataset} analysis={analysis} /></div>}
    </div>}
  </div>;
}
