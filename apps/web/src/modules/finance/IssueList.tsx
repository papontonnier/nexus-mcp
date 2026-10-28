import { CircleAlert, Info, TriangleAlert } from "lucide-react";
import type { FinanceIssue } from "@nexus/finance-solutions/types";

const ICONS = { error: CircleAlert, warning: TriangleAlert, info: Info };
const LABELS = { error: "Error", warning: "Warning", info: "Info" };

/** Severity is always shown with an icon and a label, never by color alone. */
export default function IssueList({ issues, empty }: { issues: FinanceIssue[]; empty: string }) {
  if (!issues.length) return <div className="result-empty fin-ok">{empty}</div>;
  return <ul className="fin-issues">{issues.map((issue, i) => {
    const Icon = ICONS[issue.severity];
    return <li key={i} className={"fin-issue " + issue.severity}>
      <Icon size={16} aria-hidden="true" /><span className="fin-issue-label">{LABELS[issue.severity]}</span>
      <div><p>{issue.message}</p>{issue.rows && <small>Row{issue.count === 1 ? "" : "s"} {issue.rows.join(", ")}{issue.count! > issue.rows.length ? ` … (${issue.count} in total)` : ""}</small>}</div>
      <code>{issue.code}</code>
    </li>;
  })}</ul>;
}
