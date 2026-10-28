import type { ColumnRole, DatasetInput, DimensionKind, DimensionResult, DimensionRule, DimensionValidation, ValueCount, ValueFormat } from "./types.js";
import { columnIndex, FinanceError, loadDataset } from "./dataset.js";
import { analyzeTable, IssueLog } from "./analyze.js";
import { checkCurrency, closest, dateShape, parsePeriod } from "./values.js";

const KINDS: DimensionKind[] = ["entity", "account", "costCenter", "period", "scenario", "version", "currency", "custom"];
const FORMATS: ValueFormat[] = ["any", "iso-currency", "period", "date", "numeric", "alphanumeric"];
const INFERRED: Partial<Record<ColumnRole, { required: boolean; format: ValueFormat }>> = {
  entity: { required: true, format: "any" }, account: { required: true, format: "any" }, costCenter: { required: false, format: "any" },
  period: { required: true, format: "period" }, scenario: { required: true, format: "any" }, version: { required: false, format: "any" },
  currency: { required: true, format: "iso-currency" }
};
const MAX_LISTED = 100;

function matchesFormat(value: string, format: ValueFormat): boolean {
  switch (format) {
    case "any": return true;
    case "iso-currency": { const check = checkCurrency(value); return check === "active" || check === "withdrawn"; }
    case "period": return !!parsePeriod(value, true);
    case "date": return !!dateShape(value);
    case "numeric": return /^\d+$/.test(value);
    case "alphanumeric": return /^[A-Za-z0-9_.-]+$/.test(value);
  }
}

function validateRules(rules: DimensionRule[]): void {
  if (!Array.isArray(rules) || rules.length > 30) throw new FinanceError("INVALID_INPUT", "Provide at most 30 dimension rules");
  for (const rule of rules) {
    if (!rule || typeof rule.column !== "string" || !rule.column.trim()) throw new FinanceError("INVALID_INPUT", "Each rule needs a column");
    if (rule.dimension && !KINDS.includes(rule.dimension)) throw new FinanceError("INVALID_INPUT", `Unknown dimension "${rule.dimension}"`);
    if (rule.format && !FORMATS.includes(rule.format)) throw new FinanceError("INVALID_INPUT", `Unknown format "${rule.format}"`);
    if (rule.allowedValues && (!Array.isArray(rule.allowedValues) || rule.allowedValues.length > 20_000 || rule.allowedValues.some(v => typeof v !== "string" || v.length > 200))) {
      throw new FinanceError("INVALID_INPUT", "allowedValues must be up to 20,000 strings of at most 200 characters");
    }
  }
}

const top = (map: Map<string, ValueCount>) => [...map.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)).slice(0, MAX_LISTED);
function tally(map: Map<string, ValueCount>, value: string, row: number) {
  const entry = map.get(value) ?? { value, count: 0, rows: [] };
  entry.count++;
  if (entry.rows.length < 5) entry.rows.push(row);
  map.set(value, entry);
}

export function validateFinancialDimensions(input: { dataset: DatasetInput; rules?: DimensionRule[] }): DimensionValidation {
  const table = loadDataset(input?.dataset);
  const inferred = !input.rules?.length;
  let rules: DimensionRule[];
  if (inferred) {
    rules = analyzeTable(table).columns.flatMap(({ profile }) => {
      const defaults = INFERRED[profile.role];
      return defaults ? [{ column: profile.name, dimension: profile.role as DimensionKind, ...defaults }] : [];
    });
  } else {
    validateRules(input.rules!);
    rules = input.rules!;
  }
  const log = new IssueLog();
  const results = rules.map((rule): DimensionResult => {
    const index = columnIndex(table, rule.column);
    const dimension = rule.dimension ?? "custom";
    const format = rule.format ?? (dimension === "currency" ? "iso-currency" : dimension === "period" ? "period" : "any");
    const required = rule.required ?? true;
    const label = rule.label?.trim() || table.headers[index];
    const fold = (v: string) => rule.caseSensitive ? v : v.toLowerCase();
    const reference = rule.allowedValues?.length ? new Set(rule.allowedValues.map(v => fold(v.trim()))) : undefined;
    const values = new Map<string, ValueCount>(), invalid = new Map<string, ValueCount>(), unknown = new Map<string, ValueCount>();
    const missingRows: number[] = [];
    table.rows.forEach((row, i) => {
      const value = (row[index] ?? "").trim();
      if (!value) { missingRows.push(i + 1); return; }
      tally(values, value, i + 1);
      const lengthOk = (rule.minLength === undefined || value.length >= rule.minLength) && (rule.maxLength === undefined || value.length <= rule.maxLength);
      if (!lengthOk || !matchesFormat(value, format)) tally(invalid, value, i + 1);
      else if (reference && !reference.has(fold(value))) tally(unknown, value, i + 1);
    });
    const unknownList = top(unknown).map(entry => {
      const suggestion = closest(entry.value, rule.allowedValues!);
      return suggestion ? { ...entry, suggestion } : entry;
    });
    const missingFailed = required && missingRows.length > 0;
    if (missingFailed) log.add("error", "MISSING_DIMENSION", `${missingRows.length} row(s) have no ${label}`, { column: table.headers[index], rows: missingRows });
    if (invalid.size) {
      const count = [...invalid.values()].reduce((n, v) => n + v.count, 0);
      log.add("error", "INVALID_FORMAT", `${count} ${label} value(s) do not match the "${format}" format${rule.minLength || rule.maxLength ? " or length limits" : ""}`, { column: table.headers[index] });
    }
    if (unknown.size) {
      const count = [...unknown.values()].reduce((n, v) => n + v.count, 0);
      log.add("error", "UNKNOWN_VALUES", `${unknown.size} ${label} value(s) (${count} rows) are not in the reference list`, { column: table.headers[index] });
    }
    if (!reference && format === "any") log.add("info", "NO_REFERENCE_LIST", `${label}: ${values.size} distinct value(s) listed for review (no reference list provided)`, { column: table.headers[index] });
    return {
      column: table.headers[index], dimension, label, format, required, hasReferenceList: !!reference,
      distinct: values.size, missing: missingRows.length, missingRows: missingRows.slice(0, 10),
      invalidFormat: top(invalid), unknown: unknownList, values: top(values),
      valid: !missingFailed && !invalid.size && !unknown.size
    };
  });
  return { rowCount: table.rows.length, rules, inferred, results, issues: log.issues, valid: results.every(r => r.valid) };
}
