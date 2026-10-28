import React from "react";
import { Code2, Table2, GitCompareArrows, Check, AlertCircle, FileJson2 } from "lucide-react";

export type ToolId = "json" | "csv" | "compare";
export type HistoryEntry = { id: number; tool: ToolId; time: string; result: string };
type JsonField = { path: string; type: string; nullable?: boolean };
type CsvColumn = { name: string; inferredType: string; missing: number; examples: string[] };
type Difference = { path: string; change: "added" | "removed" | "type_changed"; sourceType?: string; targetType?: string };
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
function FieldTable({ fields }: { fields: JsonField[] }) {
  return <div className="data-table-scroll"><table className="data-table"><thead><tr><th>Field path</th><th>Type</th><th>Nullable</th></tr></thead><tbody>{fields.map((f,i) => <tr key={i}><td className="mono">{f.path}</td><td><span className="type-pill">{f.type}</span></td><td>{f.nullable ? "Yes" : "No"}</td></tr>)}</tbody></table></div>;
}
function CsvTable({ columns }: { columns: CsvColumn[] }) {
  return <div className="data-table-scroll"><table className="data-table"><thead><tr><th>Column</th><th>Inferred type</th><th>Missing</th><th>Examples</th></tr></thead><tbody>{columns.map((c,i) => <tr key={i}><td className="mono">{c.name}</td><td><span className="type-pill">{c.inferredType}</span></td><td>{c.missing}</td><td>{c.examples.join(", ") || "—"}</td></tr>)}</tbody></table></div>;
}
function DifferenceTable({ differences }: { differences: Difference[] }) {
  return <div className="data-table-scroll"><table className="data-table"><thead><tr><th>Path</th><th>Change</th><th>Source</th><th>Target</th></tr></thead><tbody>{differences.map((d,i) => <tr key={i}><td className="mono">{d.path}</td><td><span className={"diff-pill " + d.change}>{d.change.replace("_", " ")}</span></td><td>{d.sourceType ?? "—"}</td><td>{d.targetType ?? "—"}</td></tr>)}</tbody></table></div>;
}
export function AnalysisResult({ tool, result }: { tool: ToolId; result: string }) {
  let parsed: unknown;
  try { parsed = JSON.parse(result); } catch { return <pre className="result-code">{result}</pre>; }
  if (tool === "json" && isRecord(parsed) && Array.isArray(parsed.fields)) {
    const fields = parsed.fields as JsonField[];
    return <><div className="result-summary"><span><FileJson2 size={15} /> {String(parsed.format ?? "JSON").toUpperCase()}</span><span>{fields.length} fields</span><span>Root: {String(parsed.rootType ?? "unknown")}</span></div><FieldTable fields={fields} /></>;
  }
  if (tool === "csv" && isRecord(parsed) && Array.isArray(parsed.columns)) {
    const columns = parsed.columns as CsvColumn[];
    return <><div className="result-summary"><span><Table2 size={15} /> CSV</span><span>{String(parsed.rowCount ?? 0)} rows</span><span>{columns.length} columns</span></div><CsvTable columns={columns} /></>;
  }
  if (tool === "compare" && Array.isArray(parsed)) {
    const differences = parsed as Difference[];
    return <><div className="result-summary"><span><GitCompareArrows size={15} /> Schema diff</span><span>{differences.length} differences</span></div>{differences.length ? <DifferenceTable differences={differences} /> : <div className="result-empty"><Check size={17} /> No structural differences found.</div>}</>;
  }
  return <pre className="result-code">{result}</pre>;
}
function highlightJson(raw: string) {
  const parts: React.ReactNode[] = [];
  const pattern = /("(?:\\.|[^"\\])*"\s*:)|("(?:\\.|[^"\\])*")|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  let start = 0; let match: RegExpExecArray | null; let key = 0;
  while ((match = pattern.exec(raw)) !== null) {
    if (match.index > start) parts.push(raw.slice(start, match.index));
    parts.push(<span key={key++} className={match[1] ? "token-key" : match[2] ? "token-string" : match[3] ? "token-bool" : "token-number"}>{match[0]}</span>);
    start = pattern.lastIndex;
  }
  if (start < raw.length) parts.push(raw.slice(start));
  return parts;
}
export function CodeEditor({ value, onChange, language, label }: { value: string; onChange: (v: string) => void; language: "json" | "csv"; label: string }) {
  const overlay = React.useRef<HTMLPreElement>(null);
  const sync = (target: HTMLTextAreaElement) => { if (overlay.current) { overlay.current.scrollTop = target.scrollTop; overlay.current.scrollLeft = target.scrollLeft; } };
  return <div className="code-editor"><pre aria-hidden="true" ref={overlay} className="code-highlight"><code>{language === "json" ? highlightJson(value) : value}<span>{"\n"}</span></code></pre><textarea id="data-input" aria-label={label} spellCheck={false} autoCapitalize="off" autoComplete="off" value={value} onChange={e => onChange(e.target.value)} onScroll={e => sync(e.currentTarget)} /></div>;
}
export const toolIcons = { json: Code2, csv: Table2, compare: GitCompareArrows };
export { AlertCircle };
