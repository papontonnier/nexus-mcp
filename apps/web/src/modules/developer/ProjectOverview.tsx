import React from "react";
import { Boxes, FileCog, Hammer, Layers, Lock, Package, Sparkles, TriangleAlert } from "lucide-react";
import type { Detection, ProjectInspection } from "@nexus/developer-toolkit/types";
import LanguageBar from "./LanguageBar";
import { formatBytes, plural } from "./format";

function DetectionCard({ title, icon: Icon, items, empty, showCategory }: { title: string; icon: React.ComponentType<{ size?: number }>; items: Detection[]; empty: string; showCategory?: boolean }) {
  return <div className="dev-card">
    <div className="dev-card-title"><Icon size={16} /><h3>{title}</h3><span>{items.length}</span></div>
    {items.length ? <ul className="dev-detect-list">{items.map(item => <li key={item.name} title={"Evidence: " + item.evidence.join(", ")}>
      <span className="dev-detect-name">{item.name}{showCategory && <span className="dev-tag">{item.category}</span>}</span>
      <small>{item.evidence[0]}</small>
    </li>)}</ul> : <p className="dev-card-empty">{empty}</p>}
  </div>;
}

export default function ProjectOverview({ inspection }: { inspection: ProjectInspection }) {
  const { stats } = inspection;
  return <div className="dev-overview">
    <div className="dev-summary"><Sparkles size={17} /><p>{inspection.summary}</p></div>
    <div className="result-summary">
      <span>{plural(stats.files, "file")}</span><span>{plural(stats.directories, "folder")}</span><span>{formatBytes(stats.totalBytes)}</span>
      <span>{plural(inspection.manifests.length, "manifest")}</span>{inspection.monorepo && <span><Boxes size={14} /> Monorepo</span>}<span>Scanned in {stats.durationMs} ms</span>
    </div>
    {stats.truncated && <div className="dev-notice"><TriangleAlert size={16} /> Scan limits were reached: very large or deeply nested folders were only partly analyzed.</div>}
    <section className="dev-section">
      <div className="dev-section-heading"><h3>Languages</h3><p>Share of source code by size. Data and documentation files are listed separately.</p></div>
      <LanguageBar languages={inspection.languages} />
      {inspection.dataFormats.length > 0 && <p className="dev-inline-list"><span>Data & docs</span>{inspection.dataFormats.map(f => <span key={f.name} className="chip">{f.name} · {f.files}</span>)}</p>}
    </section>
    <div className="dev-card-grid">
      <DetectionCard title="Frameworks & libraries" icon={Layers} items={inspection.frameworks} empty="No known framework detected." showCategory />
      <DetectionCard title="Build tools" icon={Hammer} items={inspection.buildTools} empty="No build tool detected." />
      <DetectionCard title="Package managers" icon={Package} items={inspection.packageManagers} empty="No package manager detected." />
    </div>
    <section className="dev-section">
      <div className="dev-section-heading"><h3><FileCog size={16} /> Configuration files</h3><p>Detected by name only. <Lock size={12} /> marks files whose contents NEXUS never reads.</p></div>
      {inspection.configFiles.length ? <div className="data-table-scroll"><table className="data-table dev-table"><thead><tr><th>Path</th><th>Kind</th></tr></thead><tbody>
        {inspection.configFiles.map(c => <tr key={c.path}><td className="mono">{c.path}{c.sensitive && <span className="dev-badge sensitive" title="Contents are never read"><Lock size={11} /> sensitive</span>}</td><td><span className="type-pill">{c.kind}</span></td></tr>)}
      </tbody></table></div> : <div className="result-empty">No configuration files detected.</div>}
    </section>
    {stats.excludedDirectories.length > 0 && <p className="dev-inline-list"><span>Skipped folders</span>{stats.excludedDirectories.map(d => <span key={d} className="chip">{d}</span>)}</p>}
  </div>;
}
