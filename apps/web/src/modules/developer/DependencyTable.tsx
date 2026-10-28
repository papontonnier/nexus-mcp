import React from "react";
import { Package, Search, TriangleAlert } from "lucide-react";
import type { DependencyAnalysis, DependencyScope } from "@nexus/developer-toolkit/types";
import { formatNumber, plural } from "../../services/format";

const SCOPE_LABELS: Record<DependencyScope, string> = {
  production: "Production", development: "Development", peer: "Peer", optional: "Optional", provided: "Provided", build: "Build", managed: "Managed"
};
const ECOSYSTEM_LABELS: Record<string, string> = { npm: "npm", maven: "Maven", gradle: "Gradle", pypi: "PyPI" };

export default function DependencyTable({ analysis }: { analysis: DependencyAnalysis }) {
  const [query, setQuery] = React.useState("");
  const [scope, setScope] = React.useState("");
  const [manifest, setManifest] = React.useState("");
  const rows = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return analysis.dependencies.filter(d => (!needle || d.name.toLowerCase().includes(needle)) && (!scope || d.scope === scope) && (!manifest || d.manifest === manifest));
  }, [analysis, query, scope, manifest]);
  const warnings = analysis.manifests.flatMap(m => m.warnings.map(w => ({ manifest: m.path, warning: w })));
  const { summary } = analysis;
  return <div className="dev-dependencies">
    <div className="result-summary">
      <span><Package size={14} /> {formatNumber(summary.total)} declared</span><span>{formatNumber(summary.unique)} unique</span>
      {summary.internal > 0 && <span>{summary.internal} internal</span>}
      {Object.entries(summary.byEcosystem).map(([ecosystem, count]) => <span key={ecosystem}>{ECOSYSTEM_LABELS[ecosystem] ?? ecosystem} · {count}</span>)}
      <span>{plural(analysis.manifests.length, "manifest")}</span>
    </div>
    {(analysis.technologies.length > 0 || analysis.packageManagers.length > 0) && <p className="dev-inline-list">
      <span>Stack</span>{analysis.technologies.map(t => <span key={t.name} className="chip" title={t.evidence.join(", ")}>{t.name}</span>)}
      {analysis.packageManagers.map(m => <span key={m.name} className="chip active" title={m.evidence.join(", ")}>{m.name}</span>)}
    </p>}
    {analysis.truncated && <div className="dev-notice"><TriangleAlert size={16} /> Scan limits were reached: some manifests may not be included.</div>}
    <div className="dev-toolbar">
      <label className="knowledge-search dev-search"><Search size={16} /><input aria-label="Filter dependencies" value={query} onChange={e => setQuery(e.target.value)} placeholder="Filter by package name…" /></label>
      <select aria-label="Filter by scope" value={scope} onChange={e => setScope(e.target.value)}>
        <option value="">All scopes</option>
        {(Object.keys(summary.byScope) as DependencyScope[]).map(s => <option key={s} value={s}>{SCOPE_LABELS[s]} ({summary.byScope[s]})</option>)}
      </select>
      <select aria-label="Filter by manifest" value={manifest} onChange={e => setManifest(e.target.value)}>
        <option value="">All manifests</option>
        {analysis.manifests.filter(m => m.dependencyCount > 0).map(m => <option key={m.path} value={m.path}>{m.path} ({m.dependencyCount})</option>)}
      </select>
    </div>
    {rows.length ? <div className="data-table-scroll"><table className="data-table dev-table">
      <thead><tr><th>Package</th><th>Version</th><th>Scope</th><th className="dev-col-manifest">Manifest</th></tr></thead>
      <tbody>{rows.map((d, i) => <tr key={`${d.manifest}:${d.scope}:${d.name}:${i}`}>
        <td className="mono">{d.name}{d.internal && <span className="dev-badge" title="Declared by another manifest of this project">internal</span>}</td>
        <td className="mono">{d.version ?? "—"}</td>
        <td><span className={"dev-scope " + d.scope} title={d.rawScope}>{SCOPE_LABELS[d.scope]}</span></td>
        <td className="mono dev-col-manifest">{d.manifest}</td>
      </tr>)}</tbody>
    </table></div> : <div className="result-empty">{analysis.dependencies.length ? "No dependency matches these filters." : "No dependency manifest found (package.json, pom.xml, build.gradle, requirements.txt, pyproject.toml)."}</div>}
    {warnings.length > 0 && <details className="dev-warnings"><summary><TriangleAlert size={14} /> {warnings.length} parsing note{warnings.length === 1 ? "" : "s"}</summary>
      <ul>{warnings.map((w, i) => <li key={i}><span className="mono">{w.manifest}</span> {w.warning}</li>)}</ul>
    </details>}
  </div>;
}
