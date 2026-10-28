import React from "react";
import { CheckCircle2, Plus, ShieldCheck, Trash2, XCircle } from "lucide-react";
import type { DatasetAnalysis, DatasetInput, DimensionKind, DimensionRule, DimensionValidation, ValueFormat } from "@nexus/finance-solutions/types";
import { errorMessage } from "../../services/format";
import { financeApi } from "./api";
import IssueList from "./IssueList";

type RuleDraft = DimensionRule & { reference: string };
const KINDS: DimensionKind[] = ["entity", "account", "costCenter", "period", "scenario", "version", "currency", "custom"];
const FORMATS: ValueFormat[] = ["any", "iso-currency", "period", "date", "numeric", "alphanumeric"];
const DEFAULT_FORMAT: Partial<Record<DimensionKind, ValueFormat>> = { currency: "iso-currency", period: "period" };
const parseList = (text: string) => [...new Set(text.split(/[\n,;\t]+/).map(v => v.trim()).filter(Boolean))];

function initialRules(analysis: DatasetAnalysis): RuleDraft[] {
  return analysis.columns.filter(c => (KINDS as string[]).includes(c.role)).map(c => ({
    column: c.name, dimension: c.role as DimensionKind, required: c.role !== "costCenter" && c.role !== "version",
    format: DEFAULT_FORMAT[c.role as DimensionKind] ?? "any", reference: ""
  }));
}

export default function DimensionsView({ dataset, analysis }: { dataset: DatasetInput; analysis: DatasetAnalysis }) {
  const [rules, setRules] = React.useState<RuleDraft[]>(() => initialRules(analysis));
  const [result, setResult] = React.useState<DimensionValidation | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const update = (index: number, patch: Partial<RuleDraft>) => setRules(list => list.map((r, i) => i === index ? { ...r, ...patch } : r));

  async function validate() {
    setBusy(true); setError("");
    try {
      const payload = rules.map(({ reference, ...rule }) => { const allowed = parseList(reference); return allowed.length ? { ...rule, allowedValues: allowed } : rule; });
      setResult(await financeApi.dimensions(dataset, payload));
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }

  return <div className="fin-dimensions">
    <div className="fin-section-heading"><h3>Rules</h3><p>Paste reference lists (master data) to catch unknown codes. One value per line, or separated by commas or semicolons.</p></div>
    <div className="fin-rules">
      {rules.map((rule, i) => <div key={i} className="fin-rule">
        <div className="fin-rule-fields">
          <label>Column<select value={rule.column} onChange={e => update(i, { column: e.target.value })}>{analysis.columns.map(c => <option key={c.index}>{c.name}</option>)}</select></label>
          <label>Dimension<select value={rule.dimension} onChange={e => { const dimension = e.target.value as DimensionKind; update(i, { dimension, format: DEFAULT_FORMAT[dimension] ?? rule.format }); }}>{KINDS.map(k => <option key={k}>{k}</option>)}</select></label>
          <label>Format<select value={rule.format} onChange={e => update(i, { format: e.target.value as ValueFormat })}>{FORMATS.map(f => <option key={f}>{f}</option>)}</select></label>
          <label className="fin-check"><input type="checkbox" checked={rule.required ?? true} onChange={e => update(i, { required: e.target.checked })} /> Required</label>
          <button className="secondary-button fin-icon-button" aria-label={`Remove rule for ${rule.column}`} onClick={() => setRules(list => list.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
        </div>
        <textarea className="fin-reference" aria-label={`Reference values for ${rule.column}`} placeholder="Reference values (optional), e.g. FR01, DE01, IT01" value={rule.reference} onChange={e => update(i, { reference: e.target.value })} rows={2} />
        {rule.reference && <small className="fin-hint">{parseList(rule.reference).length} reference value(s)</small>}
      </div>)}
    </div>
    <div className="fin-actions">
      <button className="secondary-button fin-with-icon" onClick={() => setRules(list => [...list, { column: analysis.columns[0].name, dimension: "custom", format: "any", required: true, reference: "" }])}><Plus size={14} /> Add rule</button>
      <button className="primary-button fin-primary" disabled={busy || !rules.length} onClick={() => void validate()}><ShieldCheck size={15} /> {busy ? "Validating…" : "Validate dimensions"}</button>
    </div>
    {error && <div className="error-box" role="alert">{error}</div>}
    {result && <>
      <div className="fin-section-heading fin-results-heading"><h3>Results</h3><p>{result.valid ? "All dimensions are valid." : "Some dimensions need attention."}</p></div>
      <div className="fin-dimension-grid">{result.results.map(r => <div key={r.column + r.dimension} className={"fin-dimension " + (r.valid ? "valid" : "invalid")}>
        <div className="fin-dimension-title">{r.valid ? <CheckCircle2 size={16} /> : <XCircle size={16} />}<strong>{r.label}</strong><span className="type-pill">{r.dimension}</span></div>
        <p className="fin-dimension-meta">{r.distinct} distinct · {r.missing} missing · format {r.format}{r.hasReferenceList ? " · reference list" : ""}</p>
        {r.unknown.length > 0 && <table className="fin-mini-table"><thead><tr><th>Unknown value</th><th>Rows</th><th>Did you mean</th></tr></thead><tbody>
          {r.unknown.map(u => <tr key={u.value}><td className="mono">{u.value}</td><td>{u.count}</td><td className="mono">{u.suggestion ?? "—"}</td></tr>)}
        </tbody></table>}
        {r.invalidFormat.length > 0 && <p className="fin-dimension-list"><span>Invalid format</span>{r.invalidFormat.map(v => <code key={v.value}>{v.value} ×{v.count}</code>)}</p>}
        {!r.hasReferenceList && r.values.length > 0 && <p className="fin-dimension-list"><span>Values</span>{r.values.slice(0, 12).map(v => <code key={v.value}>{v.value} ×{v.count}</code>)}{r.values.length > 12 && <small>+{r.values.length - 12}</small>}</p>}
      </div>)}</div>
      <IssueList issues={result.issues.filter(i => i.severity !== "info")} empty="No dimension issue." />
    </>}
  </div>;
}
