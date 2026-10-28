import React from "react";
import { Download, FileJson2, Table2 } from "lucide-react";
import type { DatasetAnalysis, DatasetInput, FieldMapping, FieldType, FinanceMapping, MappedField, TargetModel, Transform } from "@nexus/finance-solutions/types";
import { errorMessage } from "../../services/format";
import { download, financeApi } from "./api";
import IssueList from "./IssueList";

const PRESETS: Record<FieldType, { label: string; transforms: Transform[] }[]> = {
  number: [{ label: "Number", transforms: ["number"] }, { label: "Number, negated", transforms: ["number", "negate"] }, { label: "Number, absolute", transforms: ["number", "absolute"] }],
  text: [{ label: "Trim", transforms: ["trim"] }, { label: "Trim + upper case", transforms: ["trim", "uppercase"] }, { label: "Trim + lower case", transforms: ["trim", "lowercase"] }, { label: "As is", transforms: [] }],
  date: [{ label: "ISO date", transforms: ["date-iso"] }],
  period: [{ label: "Month (YYYY-MM)", transforms: ["period-month"] }, { label: "Quarter (YYYY-Qn)", transforms: ["period-quarter"] }, { label: "Year", transforms: ["period-year"] }]
};
const CONSTANT = "__constant";
const toOverride = (m: MappedField): FieldMapping => ({ target: m.target, ...(m.source ? { source: m.source } : {}), ...(m.subtract ? { subtract: m.subtract } : {}), ...(m.constant !== undefined && !m.source ? { constant: m.constant } : {}), transforms: m.transforms });

export default function MappingView({ dataset, analysis }: { dataset: DatasetInput; analysis: DatasetAnalysis }) {
  const [templates, setTemplates] = React.useState<TargetModel[]>([]);
  const [targetId, setTargetId] = React.useState("epm-fact");
  const [overrides, setOverrides] = React.useState<Record<string, FieldMapping>>({});
  const [result, setResult] = React.useState<FinanceMapping | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const run = React.useRef(0);

  React.useEffect(() => { financeApi.templates().then(setTemplates).catch(e => setError(errorMessage(e))); }, []);
  React.useEffect(() => {
    const current = ++run.current;
    setBusy(true); setError("");
    financeApi.mapping(dataset, targetId, Object.values(overrides))
      .then(mapping => { if (run.current === current) setResult(mapping); })
      .catch(e => { if (run.current === current) setError(errorMessage(e)); })
      .finally(() => { if (run.current === current) setBusy(false); });
  }, [dataset, targetId, overrides]);

  const change = (m: MappedField, patch: Partial<FieldMapping>) => setOverrides(all => {
    const next = { ...toOverride(m), ...patch };
    for (const key of Object.keys(patch) as (keyof FieldMapping)[]) if (patch[key] === undefined) delete next[key];
    return { ...all, [m.target]: next };
  });
  function chooseSource(m: MappedField, field: FieldType, value: string) {
    if (value === CONSTANT) change(m, { source: undefined, subtract: undefined, constant: m.constant ?? "", transforms: [] });
    else if (!value) change(m, { source: undefined, subtract: undefined, constant: undefined, transforms: [] });
    else change(m, { source: value, constant: undefined, transforms: PRESETS[field][0].transforms });
  }
  async function exportData() {
    setBusy(true);
    try { const full = await financeApi.mapping(dataset, targetId, Object.values(overrides), true); download(`${targetId}-data.csv`, full.exports.dataCsv ?? ""); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }

  const fields = new Map(result?.target.fields.map(f => [f.name, f]));
  return <div className="fin-mapping">
    <div className="fin-target-bar">
      <label>Target layout<select value={targetId} onChange={e => { setTargetId(e.target.value); setOverrides({}); }}>{templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      {Object.keys(overrides).length > 0 && <button className="secondary-button" onClick={() => setOverrides({})}>Reset to suggestions</button>}
    </div>
    {result && <p className="fin-target-description">{result.target.description}</p>}
    {error && <div className="error-box" role="alert">{error}</div>}
    {result && <>
      <div className="data-table-scroll"><table className="data-table fin-table fin-mapping-table">
        <thead><tr><th>Target field</th><th>Source</th><th>Transform</th><th className="fin-col-details">Match</th></tr></thead>
        <tbody>{result.mappings.map(m => {
          const field = fields.get(m.target)!;
          const presets = PRESETS[field.type];
          const key = m.transforms.join("|");
          return <tr key={m.target}>
            <td><strong>{m.target}</strong>{field.required && <span className="fin-required">required</span>}<small className="fin-field-type">{field.type}</small></td>
            <td className="fin-source">
              <select aria-label={`Source for ${m.target}`} value={m.source ?? (m.constant !== undefined ? CONSTANT : "")} onChange={e => chooseSource(m, field.type, e.target.value)} disabled={busy}>
                <option value="">— none —</option><option value={CONSTANT}>Constant value…</option>
                {analysis.columns.map(c => <option key={c.index} value={c.name}>{c.name}</option>)}
              </select>
              {!m.source && m.constant !== undefined && <input aria-label={`Constant for ${m.target}`} defaultValue={m.constant} maxLength={200} onBlur={e => e.target.value !== m.constant && change(m, { constant: e.target.value })} placeholder="Value" />}
              {field.type === "number" && m.source && <select aria-label={`Subtract for ${m.target}`} value={m.subtract ?? ""} onChange={e => change(m, { subtract: e.target.value || undefined })} disabled={busy}>
                <option value="">No subtraction</option>{analysis.columns.filter(c => c.name !== m.source).map(c => <option key={c.index} value={c.name}>− {c.name}</option>)}
              </select>}
            </td>
            <td>{m.source || m.subtract ? <select aria-label={`Transform for ${m.target}`} value={key} onChange={e => change(m, { transforms: e.target.value ? e.target.value.split("|") as Transform[] : [] })} disabled={busy}>
              {!presets.some(p => p.transforms.join("|") === key) && <option value={key}>{key || "none"}</option>}
              {presets.map(p => <option key={p.label} value={p.transforms.join("|")}>{p.label}</option>)}
            </select> : <span className="fin-muted">—</span>}</td>
            <td className="fin-col-details"><span className={"fin-confidence " + m.confidence}>{m.origin === "user" ? "manual" : m.confidence}</span> <small title={m.candidates.map(c => `${c.source} (${c.score})`).join(", ")}>{m.reason}</small>{m.errors > 0 && <span className="fin-errors">{m.errors} error{m.errors === 1 ? "" : "s"}</span>}</td>
          </tr>;
        })}</tbody>
      </table></div>
      {result.unusedColumns.length > 0 && <p className="fin-inline-list"><span>Unused columns</span>{result.unusedColumns.map(c => <span key={c} className="chip">{c}</span>)}</p>}
      <div className="fin-section-heading fin-results-heading"><h3>Checks</h3><p>{result.complete ? "Every required field is mapped and every row converts." : `${result.rowCount} rows tested.`}</p></div>
      <IssueList issues={result.issues} empty="Mapping complete: every row converts." />
      {result.valueChecks.map(check => <p key={check.target} className="fin-inline-list"><span>{check.target}: not allowed</span>{check.unknown.map(u => <code key={u.value}>{u.value}{u.suggestion ? ` → ${u.suggestion}` : ""}</code>)}</p>)}
      <div className="fin-section-heading fin-results-heading"><h3>Preview</h3><p>First {result.preview.rows.length} rows after transformation.</p></div>
      <div className="data-table-scroll"><table className="data-table fin-table">
        <thead><tr>{result.preview.columns.map(c => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>{result.preview.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j} className="mono">{cell ?? <span className="fin-muted">∅</span>}</td>)}</tr>)}</tbody>
      </table></div>
      <div className="fin-actions">
        <button className="secondary-button fin-with-icon" onClick={() => download(`${targetId}-mapping.csv`, result.exports.mappingCsv)}><Table2 size={14} /> Mapping (CSV)</button>
        <button className="secondary-button fin-with-icon" onClick={() => download(`${targetId}-mapping.json`, result.exports.mappingJson, "application/json")}><FileJson2 size={14} /> Mapping (JSON)</button>
        <button className="primary-button fin-primary" disabled={busy} onClick={() => void exportData()}><Download size={15} /> Transformed data (CSV)</button>
      </div>
    </>}
    {!result && busy && <div className="result-empty">Preparing mapping…</div>}
  </div>;
}
