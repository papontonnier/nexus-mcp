import React from "react";
import { CornerLeftUp, File, FileCode2, Folder, FolderGit2, Link2, Lock, Search, TriangleAlert, X } from "lucide-react";
import type { DevProject, FileEntry, ProjectFileSearch, ProjectTree } from "@nexus/developer-toolkit/types";
import { developerApi } from "./api";
import { errorMessage, formatBytes, formatDate, plural } from "./format";

const CODE = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs", "java", "kt", "py", "go", "rs", "cs", "php", "rb", "sql", "vue", "svelte", "css", "scss", "html", "json", "yaml", "yml", "xml", "toml", "gradle", "sh", "ps1"]);
function EntryIcon({ entry }: { entry: FileEntry }) {
  if (entry.type === "directory") return <Folder size={16} />;
  if (entry.type === "symlink") return <Link2 size={16} />;
  return entry.extension && CODE.has(entry.extension) ? <FileCode2 size={16} /> : <File size={16} />;
}
const parentOf = (path: string) => path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";

export default function FileExplorer({ project, extensions }: { project: DevProject; extensions: { extension: string; files: number }[] }) {
  const [tree, setTree] = React.useState<ProjectTree | null>(null);
  const [results, setResults] = React.useState<ProjectFileSearch | null>(null);
  const [query, setQuery] = React.useState("");
  const [extension, setExtension] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const path = tree?.path ?? "";

  const open = React.useCallback(async (target: string) => {
    setBusy(true); setError("");
    try {
      const structure = await developerApi.structure(project.id, { path: target, depth: 1 });
      if (structure.mode === "tree") { setTree(structure); setResults(null); }
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }, [project.id]);
  React.useEffect(() => { void open(""); }, [open]);

  async function search(text: string, ext: string) {
    if (!text.trim() && !ext) { setResults(null); return; }
    setBusy(true); setError("");
    try {
      const structure = await developerApi.structure(project.id, { path, q: text.trim() || undefined, ext: ext || undefined, limit: 200 });
      if (structure.mode === "search") setResults(structure);
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  function clear() { setQuery(""); setExtension(""); setResults(null); }

  const segments = path ? path.split("/") : [];
  const entries = results ? results.matches : tree?.root.children ?? [];
  const navigable = (entry: FileEntry) => entry.type === "directory" && !entry.excluded;
  return <div className="dev-explorer">
    <form className="dev-toolbar" onSubmit={e => { e.preventDefault(); void search(query, extension); }}>
      <label className="knowledge-search dev-search"><Search size={16} /><input aria-label="Search files by name" value={query} onChange={e => setQuery(e.target.value)} placeholder={`Search in ${path || project.name}…`} maxLength={120} /></label>
      <select aria-label="Filter by extension" value={extension} onChange={e => { setExtension(e.target.value); void search(query, e.target.value); }}>
        <option value="">All extensions</option>
        {extensions.map(e => <option key={e.extension} value={e.extension}>.{e.extension} ({e.files})</option>)}
      </select>
      <button type="submit" className="secondary-button" disabled={busy}>Search</button>
      {results && <button type="button" className="secondary-button dev-icon-button" onClick={clear} aria-label="Clear search"><X size={15} /></button>}
    </form>
    <nav className="dev-breadcrumb" aria-label="Current folder">
      <button onClick={() => void open("")} disabled={busy}><FolderGit2 size={14} /> {project.name}</button>
      {segments.map((segment, i) => <React.Fragment key={i}><span>/</span><button onClick={() => void open(segments.slice(0, i + 1).join("/"))} disabled={busy}>{segment}</button></React.Fragment>)}
      {results && <span className="dev-breadcrumb-note">{plural(results.matches.length, "result")} · {plural(results.scanned, "entry", "entries")} scanned</span>}
    </nav>
    {error && <div className="error-box" role="alert">{error}</div>}
    {(results?.truncated || tree?.truncated) && <div className="dev-notice"><TriangleAlert size={16} /> {results ? "Results were capped (200 matches or the scan limit). Refine the search to narrow them." :"This folder holds more entries than the listing limit."}</div>}
    <div className="data-table-scroll"><table className="data-table dev-table dev-files">
      <thead><tr><th>{results ? "Path" : "Name"}</th><th className="dev-col-size">Size</th><th className="dev-col-date">Modified</th></tr></thead>
      <tbody>
        {!results && path && <tr><td colSpan={3}><button className="dev-entry" onClick={() => void open(parentOf(path))} disabled={busy}><CornerLeftUp size={16} /> ..</button></td></tr>}
        {entries.map(entry => <tr key={entry.path} className={entry.excluded ? "dev-muted-row" : ""}>
          <td>
            {navigable(entry) || (results && entry.type === "file")
              ? <button className="dev-entry" disabled={busy} onClick={() => void open(entry.type === "directory" ? entry.path : parentOf(entry.path))} title={entry.type === "file" ? "Open containing folder" : undefined}><EntryIcon entry={entry} /><span>{results ? entry.path : entry.name}</span></button>
              : <span className="dev-entry static"><EntryIcon entry={entry} /><span>{results ? entry.path : entry.name}</span></span>}
            {entry.sensitive && <span className="dev-badge sensitive" title="Contents are never read"><Lock size={11} /> sensitive</span>}
            {entry.excluded && <span className="dev-badge" title="Generated, vendored or private folder: not explored">excluded</span>}
            {entry.type === "symlink" && <span className="dev-badge" title="Symbolic links are never followed">link</span>}
          </td>
          <td className="dev-col-size">{entry.type === "file" ? formatBytes(entry.size) : "—"}</td>
          <td className="dev-col-date">{formatDate(entry.modifiedAt)}</td>
        </tr>)}
      </tbody>
    </table></div>
    {!busy && !error && entries.length === 0 && <div className="result-empty">{results ? "No files match this search." : "This folder is empty."}</div>}
  </div>;
}
