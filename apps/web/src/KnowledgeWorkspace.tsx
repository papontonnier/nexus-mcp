import React from "react";
import { BookOpen, UploadCloud, Search, FileText, FileType2, History, Trash2, RefreshCcw, ArrowLeft, X, CheckCircle2 } from "lucide-react";
type Version = { version: number; createdAt: string; hash: string; size: number };
type Doc = { id: string; name: string; format: "md"|"txt"|"pdf"; createdAt: string; updatedAt: string; currentVersion: number; versions: Version[] };
type Detail = Doc & { content: string };
type Hit = { id: string; name: string; format: string; version: number; score: number; snippet: string };
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data: unknown = await response.json();
  if (!response.ok) throw new Error(typeof data === "object" && data && "error" in data ? String(data.error) : "Request failed (" + response.status + ")");
  return data as T;
}
function formatDate(date: string) { return new Date(date).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); }
export default function KnowledgeWorkspace() {
  const [docs, setDocs] = React.useState<Doc[]>([]);
  const [query, setQuery] = React.useState("");
  const [hits, setHits] = React.useState<Hit[] | null>(null);
  const [selected, setSelected] = React.useState<Detail | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [versionId, setVersionId] = React.useState<string | undefined>();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const refresh = React.useCallback(async () => { setDocs(await request<Doc[]>("/api/knowledge/documents")); }, []);
  React.useEffect(() => { refresh().catch(e => setError(String(e))); }, [refresh]);
  async function open(id: string, version?: number) {
    setBusy(true); setError("");
    try { setSelected(await request<Detail>("/api/knowledge/documents/" + encodeURIComponent(id) + (version ? "?version=" + version : ""))); }
    catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  async function search() {
    setBusy(true); setError("");
    try { setHits(query.trim() ? await request<Hit[]>("/api/knowledge/search?q=" + encodeURIComponent(query)) : null); }
    catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  async function upload(file: File) {
    setBusy(true); setError(""); setMessage("");
    try {
      if (!/\.(txt|md|pdf)$/i.test(file.name)) throw new Error("Only TXT, Markdown and PDF files are supported.");
      if (!file.size || file.size > 5_000_000) throw new Error("File must be between 1 byte and 5 MB.");
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let i=0;i<bytes.length;i+=8192) binary += String.fromCharCode(...bytes.subarray(i,i+8192));
      const contentBase64 = btoa(binary);
      const doc = await request<Doc>("/api/knowledge/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: file.name, contentBase64, ...(versionId ? { documentId: versionId } : {}) }) });
      setVersionId(undefined);
      setMessage("Imported " + doc.name + " · version " + doc.currentVersion);
      await refresh();
      await open(doc.id);
      if (hits) setHits(null);
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  }
  async function remove(doc: Doc) {
    if (!window.confirm("Delete " + doc.name + " and all its versions? This cannot be undone.")) return;
    setBusy(true); setError("");
    try {
      await request("/api/knowledge/documents/" + encodeURIComponent(doc.id), { method: "DELETE" });
      setSelected(null); setHits(null); await refresh(); setMessage("Document deleted.");
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  const displayed = hits ?? docs;
  return <div className="knowledge-page">
    <div className="eyebrow">LOCAL INTELLIGENCE / KNOWLEDGE ENGINE</div>
    <div className="hero-row"><div><h1>Knowledge Engine<span className="accent">.</span></h1><p className="lead">Your searchable library, versioned and stored locally.</p></div><span className="version-pill">● Knowledge v0.5</span></div>
    <div className="knowledge-stats"><div><strong>{docs.length}</strong><span>Documents</span></div><div><strong>{docs.reduce((n,d)=>n+d.versions.length,0)}</strong><span>Versions</span></div><div><strong>TXT · MD · PDF</strong><span>Supported formats</span></div></div>
    <div className="workspace-panel"><div className="panel-heading"><div><h2>Document library</h2><p>Import, search and manage your knowledge base.</p></div><button className="primary-button" disabled={busy} onClick={() => { setVersionId(undefined); fileRef.current?.click(); }}><UploadCloud size={16}/> Import document</button></div>
      <input ref={fileRef} type="file" hidden accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf" onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
      <form className="knowledge-search" onSubmit={e => { e.preventDefault(); void search(); }}><Search size={17}/><input aria-label="Search documents" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search across your documents…" /><button type="submit" disabled={busy}>Search</button>{hits && <button type="button" className="clear-search" onClick={() => { setHits(null); setQuery(""); }} aria-label="Clear search"><X size={17}/></button>}</form>
      {error && <div className="error-box" role="alert">{error}</div>}{message && <div className="knowledge-message"><CheckCircle2 size={16}/>{message}</div>}
      <div className="knowledge-list">{displayed.length ? displayed.map(d => <button className="knowledge-row" key={d.id} onClick={() => void open(d.id)}><span className="knowledge-file-icon">{d.format === "pdf" ? <FileType2 size={19}/> : <FileText size={19}/>}</span><span className="knowledge-row-main"><strong>{d.name}</strong>{ "snippet" in d ? <small>{(d as Hit).snippet}</small> : <small>Updated {formatDate((d as Doc).updatedAt)} · v{(d as Doc).currentVersion}</small>}</span><span className="chip">{d.format.toUpperCase()}</span><span className="knowledge-chevron">↗</span></button>) : <div className="knowledge-empty"><BookOpen size={30}/><strong>{hits ? "No matches found" : "Your library is empty"}</strong><p>{hits ? "Try another search term." : "Import a TXT, Markdown or PDF file to get started."}</p></div>}</div>
    </div>
    {selected && <div className="workspace-panel knowledge-detail"><div className="panel-heading"><div><button className="knowledge-back" onClick={() => setSelected(null)}><ArrowLeft size={15}/> Close document</button><h2>{selected.name}</h2><p>Version {selected.currentVersion} · {selected.format.toUpperCase()} · Updated {formatDate(selected.updatedAt)}</p></div><div className="knowledge-actions"><button className="secondary-button" disabled={busy} onClick={() => { setVersionId(selected.id); fileRef.current?.click(); }}><RefreshCcw size={14}/> New version</button><button className="secondary-button danger" disabled={busy} onClick={() => void remove(selected)}><Trash2 size={14}/> Delete</button></div></div>
      <div className="knowledge-version-bar"><History size={16}/><label htmlFor="knowledge-version">Version history</label><select id="knowledge-version" value={selected.currentVersion} onChange={e => void open(selected.id, Number(e.target.value))}>{selected.versions.map(v => <option key={v.version} value={v.version}>v{v.version} · {formatDate(v.createdAt)}</option>)}</select></div>
      <pre className="knowledge-content">{selected.content}</pre>
    </div>}
  </div>;
}
