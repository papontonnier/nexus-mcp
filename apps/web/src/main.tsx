import React from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import { AnalysisResult, CodeEditor, toolIcons } from "./IntegrationResults";
import { LayoutDashboard, BookOpen, Blocks, Wallet, Workflow, Network, Moon, Sun, Menu, ArrowUpRight, Copy, Check } from "lucide-react";

type ModuleId = "overview" | "integration" | "knowledge" | "developer" | "finance" | "agents" | "api";
type ToolId = "json" | "csv" | "compare";
type HistoryEntry = { id: number; tool: ToolId; time: string; result: string };
const modules: { id: ModuleId; icon: React.ComponentType<{ size?: number }>; title: string; subtitle: string; ready: boolean }[] = [
  { id: "integration", icon: Blocks, title: "Integration Hub", subtitle: "Structures, mappings & validation", ready: true },
  { id: "knowledge", icon: BookOpen, title: "Knowledge Engine", subtitle: "Search & document intelligence", ready: false },
  { id: "developer", icon: LayoutDashboard, title: "Developer Toolkit", subtitle: "Repository insights & dependencies", ready: false },
  { id: "finance", icon: Wallet, title: "Finance Solutions", subtitle: "Jedox, Agicap & financial datasets", ready: false },
  { id: "agents", icon: Workflow, title: "Agent Lab", subtitle: "Workflows & execution history", ready: false },
  { id: "api", icon: Network, title: "API Explorer", subtitle: "OpenAPI & payload validation", ready: false }
];
const samples: Record<ToolId, string> = {
  json: JSON.stringify({ invoice: { number: "INV-2026-001", amount: 1250, currency: "EUR", paid: false }, customer: { id: 42, name: "Acme" } }, null, 2),
  csv: "invoice_id,amount,currency,status\nINV-001,1250,EUR,paid\nINV-002,950,EUR,pending\nINV-003,,EUR,pending",
  compare: JSON.stringify({ source: { invoice: { id: 1, amount: 125 }, active: true }, target: { invoice: { id: "INV-001", amount: 125, currency: "EUR" } } }, null, 2)
};
const toolNames: Record<ToolId, string> = { json: "JSON structure", csv: "CSV analysis", compare: "Schema comparison" };
function App() {
  const [page, setPage] = React.useState<ModuleId>("overview");
  const [tool, setTool] = React.useState<ToolId>("json");
  const [input, setInput] = React.useState<Record<ToolId, string>>(samples);
  const [delimiter, setDelimiter] = React.useState(",");
  const [result, setResult] = React.useState("");
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [history, setHistory] = React.useState<HistoryEntry[]>([]);
  const [dark, setDark] = React.useState(() => localStorage.getItem("nexus-theme") === "dark");
  const [mobileNav, setMobileNav] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => { document.documentElement.dataset.theme = dark ? "dark" : "light"; localStorage.setItem("nexus-theme", dark ? "dark" : "light"); }, [dark]);
  function navigate(id: ModuleId) { setPage(id); setMobileNav(false); }
  function changeTool(id: ToolId) { setTool(id); setResult(""); setError(""); setCopied(false); }
  async function analyze() {
    setBusy(true); setError(""); setResult("");
    try {
      let url = "/api/analyze/json", payload = input.json;
      if (tool === "json") JSON.parse(input.json);
      if (tool === "csv") { url = "/api/analyze/csv"; payload = JSON.stringify({ csv: input.csv, delimiter }); }
      if (tool === "compare") {
        url = "/api/compare/json";
        const parsed: unknown = JSON.parse(input.compare);
        if (!parsed || typeof parsed !== "object" || !("source" in parsed) || !("target" in parsed)) throw new Error("Provide an object with source and target properties.");
        payload = JSON.stringify(parsed);
      }
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload });
      const data: unknown = await response.json();
      if (!response.ok) throw new Error("API " + response.status + ": " + JSON.stringify(data));
      const output = JSON.stringify(data, null, 2);
      setResult(output);
      setHistory(previous => [{ id: Date.now(), tool, time: new Date().toLocaleTimeString(), result: output }, ...previous].slice(0, 8));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  const selected = modules.find(m => m.id === page);
  return <div className="app-shell">
    <aside className={mobileNav ? "sidebar open" : "sidebar"}>
      <div className="brand"><span className="brand-symbol">✳</span><span>NEXUS <small>MCP</small></span><span className="brand-version">0.3</span></div>
      <div className="sidebar-caption">WORKSPACE</div>
      <button className={page === "overview" ? "nav-item selected" : "nav-item"} onClick={() => navigate("overview")}><span><LayoutDashboard size={18} /></span> Overview</button>
      <div className="sidebar-caption module-caption">MODULES</div>
      {modules.map(m => <button key={m.id} className={page === m.id ? "nav-item selected" : "nav-item"} onClick={() => navigate(m.id)}><span><m.icon size={18} /></span><span className="nav-label">{m.title}</span>{!m.ready && <span className="nav-dot" title="Planned" />}</button>)}
      <div className="sidebar-bottom"><span className="status-dot" /> Local workspace <span className="sidebar-local">Private</span></div>
    </aside>
    {mobileNav && <button className="nav-overlay" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
    <div className="content-area">
      <header className="topbar"><div className="topbar-left"><button className="mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu size={18} /></button><span>Workspace</span><span className="crumb">/</span><strong>{page === "overview" ? "Overview" : selected?.title}</strong></div><div className="topbar-actions"><span className="local-badge"><span className="status-dot" /> Local</span><button className="theme-button" aria-label="Toggle theme" title="Toggle theme" onClick={() => setDark(!dark)}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button></div></header>
      <main className="main-content">
        {page === "overview" ? <>
          <div className="eyebrow">YOUR PERSONAL INTELLIGENCE WORKSPACE</div>
          <div className="hero-row"><div><h1>Welcome to Nexus<span className="accent">.</span></h1><p className="lead">One workspace. Six connected capabilities. Your tools, your data, your control.</p></div><span className="version-pill">● Foundation v0.3</span></div>
          <div className="stats-grid"><div className="stat-card"><span>Modules</span><strong>06</strong><small>Designed for your workflow</small></div><div className="stat-card"><span>Available tools</span><strong>03</strong><small>Integration Hub</small></div><div className="stat-card"><span>Execution</span><strong>Local</strong><small>No paid AI API required</small></div></div>
          <div className="section-heading"><div><h2>Explore your modules</h2><p>Purpose-built capabilities, connected through MCP.</p></div></div>
          <div className="module-grid">{modules.map(m => <button className="module-card" key={m.id} onClick={() => navigate(m.id)}><div className="module-card-top"><span className="module-icon"><m.icon size={23} /></span><span className={m.ready ? "chip active" : "chip"}>{m.ready ? "Available" : "Planned"}</span></div><h3>{m.title}</h3><p>{m.subtitle}</p><span className="module-arrow"><ArrowUpRight size={17} /></span></button>)}</div>
        </> : page === "integration" ? <>
          <div className="eyebrow">DATA INTELLIGENCE / INTEGRATION HUB</div><h1>Integration Hub<span className="accent">.</span></h1><p className="lead">Inspect, understand and compare your data structures.</p>
          <div className="workspace-panel"><div className="panel-heading"><div><h2>Analysis workspace</h2><p>Run the same core operations available through MCP.</p></div><span className="chip active">3 tools online</span></div>
            <div className="tool-tabs" role="tablist" aria-label="Analysis tools">{(["json","csv","compare"] as ToolId[]).map(t => <button key={t} role="tab" aria-selected={tool === t} className={tool === t ? "tool-tab active" : "tool-tab"} onClick={() => changeTool(t)}>{React.createElement(toolIcons[t], { size: 15 })}{toolNames[t]}</button>)}</div>
            <div className="editor-label"><label htmlFor="data-input">{tool === "json" ? "JSON document" : tool === "csv" ? "CSV document" : "Source and target JSON"}</label><span>{tool === "compare" ? "Object containing source and target" : "Editable sample"}</span></div>
            <CodeEditor label={toolNames[tool]} language={tool === "csv" ? "csv" : "json"} value={input[tool]} onChange={value => setInput(p => ({ ...p, [tool]: value }))} />
            <div className="editor-footer">{tool === "csv" && <label className="delimiter-label">Delimiter <input aria-label="CSV delimiter" maxLength={1} value={delimiter} onChange={e => setDelimiter(e.target.value)} /></label>}<span className="hint">Processed locally via NEXUS API</span><button className="primary-button" disabled={busy} onClick={analyze}>{busy ? "Analyzing…" : "Run analysis"} <span>↗</span></button></div>
          </div>
          <div className="workspace-panel result-panel"><div className="panel-heading"><div><h2>Output</h2><p>Structured result from the shared analysis engine.</p></div>{result && <button className="secondary-button copy-button" onClick={() => navigator.clipboard.writeText(result).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1800); }).catch(() => setError("Clipboard unavailable"))}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? "Copied" : "Copy JSON"}</button>}</div>{error ? <div role="alert" className="error-box">{error}</div> : result ? <AnalysisResult tool={tool} result={result} /> : <div className="result-empty">Run an analysis to see structured results here.</div>}</div>
          {history.length > 0 && <div className="workspace-panel"><div className="panel-heading"><div><h2>Recent runs</h2><p>Session history · not persisted</p></div></div><div className="history-list">{history.map(h => <button key={h.id} onClick={() => { setTool(h.tool); setResult(h.result); setError(""); }}><span>{toolNames[h.tool]}</span><time>{h.time}</time><span>↗</span></button>)}</div></div>}
        </> : <>
          <div className="eyebrow">NEXUS MODULE / ROADMAP</div><div className="placeholder-icon">{selected && <selected.icon size={32} />}</div><h1>{selected?.title}<span className="accent">.</span></h1><p className="lead">{selected?.subtitle}</p><div className="coming-card"><span className="chip">Planned</span><h2>Built into the roadmap.</h2><p>This module is part of the six-module NEXUS architecture. Its tools and workflows will be implemented in a future iteration.</p><button className="secondary-button" onClick={() => navigate("overview")}>← Back to overview</button></div>
        </>}
      </main>
    </div>
  </div>;
}
createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
