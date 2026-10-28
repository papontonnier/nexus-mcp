import { Scale } from "lucide-react";
import type { ColumnProfile, DatasetAnalysis } from "@nexus/finance-solutions/types";
import IssueList from "./IssueList";

const ROLE_LABELS: Record<string, string> = {
  amount: "Amount", debit: "Debit", credit: "Credit", date: "Date", period: "Period", currency: "Currency", entity: "Entity",
  account: "Account", costCenter: "Cost center", scenario: "Scenario", version: "Version", counterparty: "Counterparty",
  category: "Category", description: "Description", identifier: "Identifier", dimension: "Dimension", other: "Other"
};
export const roleLabel = (role: string) => ROLE_LABELS[role] ?? role;

function details(column: ColumnProfile): string {
  if (column.amount) return `Total ${column.amount.total} · min ${column.amount.min} · max ${column.amount.max}${column.amount.negatives ? ` · ${column.amount.negatives} negative` : ""}`;
  if (column.dates) return column.dates.min ? `${column.dates.min} → ${column.dates.max} · ${column.dates.formats.join(", ")}` : "—";
  if (column.periods) return column.periods.min ? `${column.periods.min} → ${column.periods.max} · ${column.periods.distinct} ${column.periods.granularity} period(s)` : "—";
  return column.examples.join(", ") || "—";
}

export default function QualityView({ analysis }: { analysis: DatasetAnalysis }) {
  return <div className="fin-quality">
    <section className="fin-section">
      <div className="fin-section-heading"><h3>Anomalies</h3><p>Errors block a reliable load, warnings deserve a check, infos are context.</p></div>
      <IssueList issues={analysis.issues} empty="No anomaly detected." />
    </section>
    {(analysis.totals.length > 0 || analysis.balance) && <section className="fin-section">
      <div className="fin-section-heading"><h3>Totals</h3><p>Exact decimal sums of valid amounts, per currency (never summed across currencies).</p></div>
      <div className="fin-totals">
        {analysis.totals.map(t => <div key={t.column + t.currency} className="fin-total"><span>{t.column}{t.currency ? ` · ${t.currency}` : ""}</span><strong>{t.total}</strong><small>{t.rows} row{t.rows === 1 ? "" : "s"}</small></div>)}
        {analysis.balance && <div className={"fin-total balance " + (analysis.balance.balanced ? "ok" : "ko")}>
          <span><Scale size={14} /> Debit − credit</span><strong>{analysis.balance.difference}</strong><small>{analysis.balance.balanced ? "Balanced" : "Not balanced"}</small>
        </div>}
      </div>
    </section>}
    <section className="fin-section">
      <div className="fin-section-heading"><h3>Columns</h3><p>Roles are detected from column names (English and French) and from the values themselves.</p></div>
      <div className="data-table-scroll"><table className="data-table fin-table">
        <thead><tr><th>Column</th><th>Detected role</th><th className="fin-col-type">Type</th><th>Missing</th><th className="fin-col-distinct">Distinct</th><th className="fin-col-details">Details</th></tr></thead>
        <tbody>{analysis.columns.map(c => <tr key={c.index}>
          <td className="mono">{c.name}</td>
          <td><span className="type-pill" title={c.reason}>{roleLabel(c.role)}</span> <span className={"fin-confidence " + c.confidence}>{c.confidence}</span></td>
          <td className="fin-col-type">{c.valueType}</td><td>{c.missing || "—"}</td><td className="fin-col-distinct">{c.distinct}</td>
          <td className="fin-col-details">{details(c)}</td>
        </tr>)}</tbody>
      </table></div>
    </section>
  </div>;
}
