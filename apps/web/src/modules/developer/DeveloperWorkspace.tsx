import React from "react";
import { Check, Copy, FolderGit2, FolderTree, LayoutGrid, Package, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import type { DependencyAnalysis, DevProject, ProjectCatalog, ProjectInspection } from "@nexus/developer-toolkit/types";
import { developerApi } from "./api";
import DependencyTable from "./DependencyTable";
import FileExplorer from "./FileExplorer";
import ProjectOverview from "./ProjectOverview";
import { errorMessage, formatBytes, formatNumber, readPreference, writePreference } from "./format";
import "./developer.css";

type Tab = "overview" | "files" | "dependencies";
const TABS: { id: Tab; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: "overview", label: "Overview", icon: LayoutGrid }, { id: "files", label: "Files", icon: FolderTree }, { id: "dependencies", label: "Dependencies", icon: Package }
];
const STATUS_LABELS: Record<DevProject["status"], string> = { ready: "Ready", missing: "Not found", invalid: "Invalid" };
const EXAMPLE = JSON.stringify({ projects: [{ name: "nexus-mcp", path: "C:/Users/you/IdeaProjects/nexus-mcp", description: "Optional note" }] }, null, 2);

function SetupCard({ configFile }: { configFile: string }) {
  const [copied, setCopied] = React.useState(false);
  return <div className="dev-setup">
    <span className="module-icon"><ShieldCheck size={22} /></span>
    <h3>No project allowed yet</h3>
    <p>NEXUS only reads folders you list explicitly. Create this file, add absolute paths, then reload. Neither the API nor MCP clients can change it.</p>
    <code className="dev-config-path">{configFile}</code>
    <div className="dev-code-block">
      <button className="secondary-button copy-button" onClick={() => navigator.clipboard.writeText(EXAMPLE).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1800); }).catch(() => undefined)}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "Copied" : "Copy"}</button>
      <pre>{EXAMPLE}</pre>
    </div>
  </div>;
}

export default function DeveloperWorkspace() {
  const [catalog, setCatalog] = React.useState<ProjectCatalog | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(() => readPreference("nexus-dev-project"));
  const [tab, setTab] = React.useState<Tab>("overview");
  const [inspection, setInspection] = React.useState<ProjectInspection | null>(null);
  const [dependencies, setDependencies] = React.useState<DependencyAnalysis | null>(null);
  const [loading, setLoading] = React.useState<"catalog" | "inspect" | "dependencies" | null>("catalog");
  const [error, setError] = React.useState("");
  // Bumped on every scan so late responses from a previous project or scan are ignored.
  const generation = React.useRef(0);
  const dependenciesRequested = React.useRef<string | null>(null);

  const loadCatalog = React.useCallback(async () => {
    setLoading("catalog"); setError("");
    try { setCatalog(await developerApi.projects()); }
    catch (e) { setError(errorMessage(e)); }
    finally { setLoading(null); }
  }, []);
  React.useEffect(() => { void loadCatalog(); }, [loadCatalog]);

  const selected = catalog?.projects.find(p => p.id === selectedId && p.status === "ready") ?? null;
  const inspect = React.useCallback(async (id: string) => {
    const scan = ++generation.current;
    dependenciesRequested.current = null;
    setInspection(null); setDependencies(null); setError(""); setLoading("inspect");
    try { const result = await developerApi.inspect(id); if (generation.current === scan) setInspection(result); }
    catch (e) { if (generation.current === scan) setError(errorMessage(e)); }
    finally { if (generation.current === scan) setLoading(null); }
  }, []);
  React.useEffect(() => { if (selected) void inspect(selected.id); }, [selected?.id, inspect]);
  React.useEffect(() => {
    if (tab !== "dependencies" || !selected || loading || dependenciesRequested.current === selected.id) return;
    const scan = generation.current;
    dependenciesRequested.current = selected.id;
    setLoading("dependencies");
    developerApi.dependencies(selected.id)
      .then(result => { if (generation.current === scan) setDependencies(result); })
      .catch(e => { if (generation.current === scan) setError(errorMessage(e)); })
      .finally(() => { if (generation.current === scan) setLoading(null); });
  }, [tab, selected, loading]);

  function choose(project: DevProject) {
    if (project.status !== "ready") return;
    setSelectedId(project.id); setTab("overview"); writePreference("nexus-dev-project", project.id);
    if (project.id === selected?.id) void inspect(project.id);
  }

  const projects = catalog?.projects ?? [];
  const ready = projects.filter(p => p.status === "ready").length;
  return <div className="developer-page">
    <div className="eyebrow">SOFTWARE INTELLIGENCE / DEVELOPER TOOLKIT</div>
    <div className="hero-row"><div><h1>Developer Toolkit<span className="accent">.</span></h1><p className="lead">Understand local projects — stack, structure and dependencies. Read-only, limited to folders you allow.</p></div><span className="version-pill">● Toolkit v0.6</span></div>
    <div className="dev-stats">
      <div><strong>{catalog ? `${ready}/${projects.length}` : "—"}</strong><span>Allowed projects ready</span></div>
      <div><strong>{inspection ? formatNumber(inspection.stats.files) : "—"}</strong><span>{inspection ? `Files scanned · ${formatBytes(inspection.stats.totalBytes)}` : "Files scanned"}</span></div>
      <div><strong>Read-only</strong><span>Allowlist · manifests only</span></div>
    </div>

    <div className="workspace-panel">
      <div className="panel-heading"><div><h2>Allowed projects</h2><p>{catalog?.configFound ? <>Defined in <span className="mono">{catalog.configFile}</span></> : "Defined by you in a local configuration file."}</p></div>
        <button className="secondary-button dev-with-icon" onClick={() => void loadCatalog()} disabled={loading === "catalog"}><RefreshCw size={14} /> Reload</button></div>
      {catalog?.issues.length ? <div className="dev-notice"><TriangleAlert size={16} /><div>{catalog.issues.map(issue => <div key={issue}>{issue}</div>)}</div></div> : null}
      {!catalog && loading === "catalog" && <div className="result-empty">Loading projects…</div>}
      {catalog && !projects.length && <SetupCard configFile={catalog.configFile} />}
      {projects.length > 0 && <div className="dev-project-grid">{projects.map(p => <button key={p.id} className={"dev-project-card" + (p.id === selected?.id ? " selected" : "") + (p.status !== "ready" ? " unavailable" : "")} onClick={() => choose(p)} disabled={p.status !== "ready"} aria-pressed={p.id === selected?.id}>
        <span className="dev-project-top"><span className="knowledge-file-icon"><FolderGit2 size={18} /></span><span className={"chip" + (p.status === "ready" ? " active" : " warning")}>{STATUS_LABELS[p.status]}</span></span>
        <strong>{p.name}</strong>
        <span className="dev-path" title={p.path}>{p.path || "—"}</span>
        {p.description && <small>{p.description}</small>}
        {p.issue && <small className="dev-issue">{p.issue}</small>}
      </button>)}</div>}
      {error && !selected && <div className="error-box" role="alert">{error}</div>}
    </div>

    {selected && <div className="workspace-panel">
      <div className="panel-heading"><div><h2>{selected.name}</h2><p className="mono dev-path">{selected.path}</p></div>
        <button className="secondary-button dev-with-icon" onClick={() => void inspect(selected.id)} disabled={loading === "inspect"}><RefreshCw size={14} /> Rescan</button></div>
      <div className="tool-tabs" role="tablist" aria-label="Project views">{TABS.map(t => <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "tool-tab active" : "tool-tab"} onClick={() => setTab(t.id)}><t.icon size={15} />{t.label}</button>)}</div>
      {error && <div className="error-box" role="alert">{error}</div>}
      {tab === "overview" && (inspection ? <ProjectOverview inspection={inspection} /> : loading === "inspect" && <div className="result-empty">Scanning project…</div>)}
      {tab === "files" && <FileExplorer key={selected.id} project={selected} extensions={inspection?.topExtensions ?? []} />}
      {tab === "dependencies" && (dependencies ? <DependencyTable analysis={dependencies} /> : loading && <div className="result-empty">Reading dependency manifests…</div>)}
    </div>}
  </div>;
}
