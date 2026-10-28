import type { ColumnProfile, ColumnRole, CurrencyTotal, DatasetAnalysis, DatasetInput, FinanceIssue } from "./types.js";
import { loadDataset, type Table } from "./dataset.js";
import { detectRole } from "./roles.js";
import { checkCurrency, detectDateOrder, formatAmount, normalizeKey, parseAmount, parseDate, parsePeriod, periodGaps, type Period } from "./values.js";

const MAX_ROWS_LISTED = 10;
const AMOUNT_ROLES: ColumnRole[] = ["amount", "debit", "credit"];
const KEY_ROLES: ColumnRole[] = ["entity", "account", "costCenter", "period", "date", "scenario", "version", "currency", "counterparty", "category", "dimension"];
const REQUIRED_ROLES: ColumnRole[] = ["amount", "account", "entity", "date", "period", "currency"];

export class IssueLog {
  readonly issues: FinanceIssue[] = [];
  add(severity: FinanceIssue["severity"], code: string, message: string, details: { column?: string; rows?: number[] } = {}) {
    const rows = details.rows;
    this.issues.push({ severity, code, message, ...(details.column ? { column: details.column } : {}), ...(rows?.length ? { count: rows.length, rows: rows.slice(0, MAX_ROWS_LISTED) } : {}) });
  }
}
const rowsWhere = (values: string[], test: (value: string) => boolean) => values.flatMap((v, i) => test(v) ? [i + 1] : []);

export type ColumnContext = { profile: ColumnProfile; values: string[]; parsed?: (bigint | null | undefined)[] };

function profileColumn(table: Table, index: number, log: IssueLog): ColumnContext {
  const name = table.headers[index];
  const values = table.rows.map(row => row[index] ?? "");
  const trimmed = values.map(v => v.trim());
  const filled = trimmed.filter(Boolean);
  const detection = detectRole(name, values, table.decimal, table.rows.length);
  const profile: ColumnProfile = {
    name, index, role: detection.role, confidence: detection.confidence, reason: detection.reason, valueType: detection.valueType,
    missing: values.length - filled.length, distinct: new Set(filled).size, examples: [...new Set(filled)].slice(0, 3)
  };
  const context: ColumnContext = { profile, values };
  const missingRows = rowsWhere(trimmed, v => !v);
  if (REQUIRED_ROLES.includes(profile.role) && missingRows.length && filled.length) {
    log.add(profile.role === "currency" ? "warning" : "error", "MISSING_VALUES", `${missingRows.length} row(s) have no ${profile.role} in "${name}"`, { column: name, rows: missingRows });
  }

  if (AMOUNT_ROLES.includes(profile.role)) {
    const parsed = values.map(v => parseAmount(v, table.decimal));
    const numbers = parsed.filter((v): v is NonNullable<typeof v> => !!v);
    const invalidRows = parsed.flatMap((v, i) => v === undefined ? [i + 1] : []);
    const maxDecimals = Math.max(2, ...numbers.map(n => n.decimals));
    const sum = numbers.reduce((total, n) => total + n.value, 0n);
    const sorted = numbers.map(n => n.value).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    profile.amount = {
      total: formatAmount(sum, maxDecimals), min: sorted.length ? formatAmount(sorted[0], maxDecimals) : "0", max: sorted.length ? formatAmount(sorted[sorted.length - 1], maxDecimals) : "0",
      negatives: numbers.filter(n => n.value < 0n).length, zeros: numbers.filter(n => n.value === 0n).length, invalid: invalidRows.length, maxDecimals
    };
    context.parsed = parsed.map(v => v ? v.value : v);
    if (invalidRows.length) log.add("error", "INVALID_AMOUNT", `${invalidRows.length} value(s) in "${name}" are not valid amounts (decimal separator "${table.decimal}")`, { column: name, rows: invalidRows });
    if (profile.amount.zeros && profile.role === "amount") log.add("info", "ZERO_AMOUNTS", `${profile.amount.zeros} row(s) have a zero amount in "${name}"`, { column: name, rows: rowsWhere(values, v => parseAmount(v, table.decimal)?.value === 0n) });
  } else if (profile.role === "date") {
    const { order, ambiguous } = detectDateOrder(filled);
    const parsed = values.map(v => v.trim() ? parseDate(v, order) : null);
    const isoDates = parsed.filter((p): p is NonNullable<typeof p> => !!p).map(p => p.iso).sort();
    const formats = [...new Set(parsed.flatMap(p => p ? [p.format] : []))];
    const invalidRows = parsed.flatMap((p, i) => p === undefined ? [i + 1] : []);
    profile.dates = { min: isoDates[0] ?? "", max: isoDates[isoDates.length - 1] ?? "", formats, invalid: invalidRows.length, ambiguous };
    if (invalidRows.length) log.add("error", "INVALID_DATE", `${invalidRows.length} value(s) in "${name}" are not valid dates`, { column: name, rows: invalidRows });
    if (formats.length > 1) log.add("warning", "MIXED_DATE_FORMATS", `"${name}" mixes date formats: ${formats.join(", ")}`, { column: name });
    if (ambiguous) log.add("info", "AMBIGUOUS_DATE_ORDER", `"${name}" could be day/month or month/day; read as day/month (European order)`, { column: name });
  } else if (profile.role === "period") {
    const parsed = values.map(v => v.trim() ? parsePeriod(v, true) : null);
    const periods = parsed.filter((p): p is Period => !!p);
    const granularities = [...new Set(periods.map(p => p.granularity))];
    const keys = [...new Set(periods.map(p => p.key))].sort();
    const invalidRows = parsed.flatMap((p, i) => p === undefined ? [i + 1] : []);
    const granularity = granularities.length === 1 ? granularities[0] : "mixed";
    const gaps = granularity === "mixed" ? [] : periodGaps(keys, granularity);
    profile.periods = { min: keys[0] ?? "", max: keys[keys.length - 1] ?? "", granularity, distinct: keys.length, gaps, invalid: invalidRows.length };
    if (invalidRows.length) log.add("error", "INVALID_PERIOD", `${invalidRows.length} value(s) in "${name}" are not recognized periods`, { column: name, rows: invalidRows });
    if (granularity === "mixed" && periods.length) log.add("warning", "MIXED_PERIOD_GRANULARITY", `"${name}" mixes ${granularities.join(", ")} periods`, { column: name });
    if (gaps.length) log.add("warning", "PERIOD_GAPS", `"${name}" has no data for ${gaps.length === 24 ? "24+" : gaps.length} period(s) between ${profile.periods.min} and ${profile.periods.max}: ${gaps.slice(0, 6).join(", ")}${gaps.length > 6 ? "…" : ""}`, { column: name });
  } else if (profile.role === "currency") {
    const invalidRows = rowsWhere(trimmed, v => !!v && checkCurrency(v) === "invalid");
    const unknown = [...new Set(filled.filter(v => checkCurrency(v) === "unknown"))];
    const withdrawn = [...new Set(filled.filter(v => checkCurrency(v) === "withdrawn"))];
    if (invalidRows.length) log.add("error", "INVALID_CURRENCY", `${invalidRows.length} value(s) in "${name}" are not 3-letter currency codes`, { column: name, rows: invalidRows });
    if (unknown.length) log.add("warning", "UNKNOWN_CURRENCY", `"${name}" contains codes that are not active ISO 4217 currencies: ${unknown.slice(0, 8).join(", ")}`, { column: name });
    if (withdrawn.length) log.add("info", "WITHDRAWN_CURRENCY", `"${name}" contains withdrawn currencies (valid for historical data only): ${withdrawn.join(", ")}`, { column: name });
    const lower = rowsWhere(trimmed, v => /^[a-z]{3}$/.test(v));
    if (lower.length) log.add("warning", "CURRENCY_CASE", `${lower.length} currency code(s) in "${name}" are not upper case`, { column: name, rows: lower });
  }

  if (KEY_ROLES.includes(profile.role) && profile.role !== "date" && profile.role !== "period") {
    const groups = new Map<string, Set<string>>();
    for (const value of filled) {
      const key = normalizeKey(value);
      groups.set(key, (groups.get(key) ?? new Set()).add(value));
    }
    const variants = [...groups.values()].filter(set => set.size > 1).map(set => [...set].join(" / "));
    if (variants.length) log.add("warning", "INCONSISTENT_VALUES", `"${name}" has values that differ only by case, spaces or accents: ${variants.slice(0, 4).join("; ")}`, { column: name });
  }
  if (profile.role === "account") {
    const lengths = [...new Set(filled.filter(v => /^\d+$/.test(v)).map(v => v.length))].sort();
    if (lengths.length > 1) log.add("info", "ACCOUNT_CODE_LENGTHS", `Numeric account codes in "${name}" have different lengths (${lengths.join(", ")} digits)`, { column: name });
  }
  const padded = rowsWhere(values, v => v !== v.trim() && !!v.trim());
  if (padded.length) log.add("info", "SURROUNDING_SPACES", `${padded.length} value(s) in "${name}" have leading or trailing spaces`, { column: name, rows: padded });
  return context;
}

export type AnalysisContext = { table: Table; columns: ColumnContext[]; log: IssueLog };

export function analyzeTable(table: Table): AnalysisContext {
  const log = new IssueLog();
  if (!table.rows.length) log.add("error", "EMPTY_DATASET", "The dataset has a header but no data rows");
  const columns = table.headers.map((_, index) => profileColumn(table, index, log));
  return { table, columns, log };
}

function totals(context: AnalysisContext): CurrencyTotal[] {
  const currency = context.columns.find(c => c.profile.role === "currency");
  return context.columns.filter(c => c.parsed).flatMap(c => {
    const groups = new Map<string | null, { total: bigint; rows: number }>();
    c.parsed!.forEach((value, i) => {
      if (typeof value !== "bigint") return;
      const code = currency ? currency.values[i].trim().toUpperCase() || null : null;
      const group = groups.get(code) ?? { total: 0n, rows: 0 };
      group.total += value; group.rows++;
      groups.set(code, group);
    });
    const decimals = c.profile.amount!.maxDecimals;
    return [...groups].map(([code, g]) => ({ column: c.profile.name, currency: code, total: formatAmount(g.total, decimals), rows: g.rows }));
  });
}

export function analyzeFinancialDataset(input: DatasetInput): DatasetAnalysis {
  const context = analyzeTable(loadDataset(input));
  const { table, columns, log } = context;
  const roles: DatasetAnalysis["roles"] = {};
  for (const { profile } of columns) (roles[profile.role] ??= []).push(profile.name);
  if (!columns.some(c => AMOUNT_ROLES.includes(c.profile.role))) log.add("warning", "NO_AMOUNT_COLUMN", "No amount, debit or credit column was recognized");

  const currencyTotals = totals(context);
  const currencies = [...new Set(currencyTotals.map(t => t.currency).filter(Boolean))];
  if (currencies.length > 1) log.add("info", "MULTIPLE_CURRENCIES", `${currencies.length} currencies (${currencies.join(", ")}): totals are reported per currency and must not be summed`);

  let balance: DatasetAnalysis["balance"];
  const debit = columns.find(c => c.profile.role === "debit"), credit = columns.find(c => c.profile.role === "credit");
  if (debit?.parsed && credit?.parsed) {
    const sum = (values: (bigint | null | undefined)[]) => values.reduce<bigint>((total, v) => total + (typeof v === "bigint" ? v : 0n), 0n);
    const d = sum(debit.parsed), c = sum(credit.parsed), decimals = Math.max(debit.profile.amount!.maxDecimals, credit.profile.amount!.maxDecimals);
    balance = { debit: formatAmount(d, decimals), credit: formatAmount(c, decimals), difference: formatAmount(d - c, decimals), balanced: d === c };
    if (!balance.balanced && currencies.length <= 1) log.add("warning", "UNBALANCED", `Debits (${balance.debit}) and credits (${balance.credit}) differ by ${balance.difference}`);
  }

  const seen = new Map<string, number>(), duplicateRows: number[] = [];
  table.rows.forEach((row, i) => {
    const key = JSON.stringify(row.map(v => v.trim()));
    if (seen.has(key)) duplicateRows.push(i + 1); else seen.set(key, i + 1);
  });
  if (duplicateRows.length) log.add("warning", "DUPLICATE_ROWS", `${duplicateRows.length} row(s) are exact duplicates of an earlier row`, { rows: duplicateRows });
  const keyColumns = columns.filter(c => KEY_ROLES.includes(c.profile.role)).map(c => c.profile);
  const duplicateKeyRows: number[] = [];
  if (keyColumns.length >= 2) {
    const keys = new Map<string, string>();
    table.rows.forEach((row, i) => {
      const key = JSON.stringify(keyColumns.map(c => row[c.index].trim()));
      const full = JSON.stringify(row.map(v => v.trim()));
      if (keys.has(key) && keys.get(key) !== full) duplicateKeyRows.push(i + 1);
      else if (!keys.has(key)) keys.set(key, full);
    });
    if (duplicateKeyRows.length) {
      // Transaction-level data (with descriptions or document numbers) legitimately repeats keys; aggregated loads should not.
      const detailed = columns.some(c => c.profile.role === "description" || c.profile.role === "identifier");
      log.add(detailed ? "info" : "warning", "DUPLICATE_KEYS", `${duplicateKeyRows.length} row(s) repeat the same ${keyColumns.map(c => c.name).join(" × ")} combination${detailed ? "" : " with different values (possible double counting in an aggregated load)"}`, { rows: duplicateKeyRows });
    }
  }
  const issues = log.issues;
  return {
    format: table.format, ...(table.delimiter ? { delimiter: table.delimiter } : {}), decimalSeparator: table.decimal,
    rowCount: table.rows.length, columnCount: table.headers.length, columns: columns.map(c => c.profile), roles, totals: currencyTotals,
    ...(balance ? { balance } : {}),
    duplicates: { exactRows: duplicateRows.length, duplicateKeys: duplicateKeyRows.length, keyColumns: keyColumns.map(c => c.name) },
    issues,
    summary: { errors: issues.filter(i => i.severity === "error").length, warnings: issues.filter(i => i.severity === "warning").length, infos: issues.filter(i => i.severity === "info").length }
  };
}
