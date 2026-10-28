import type {
  ColumnProfile, Confidence, FieldMapping, FieldType, FinanceMapping, MappedField, MappingRequest, TargetField, TargetModel, Transform, ValueMappingCheck
} from "./types.js";
import { columnIndex, FinanceError, loadDataset } from "./dataset.js";
import { analyzeTable, IssueLog } from "./analyze.js";
import { nameMatch } from "./roles.js";
import { closest, detectDateOrder, formatAmount, normalizeKey, parseAmount, parseDate, parsePeriod, periodFromDate, type DateOrder } from "./values.js";
import type { DecimalSeparator } from "./types.js";

const GENERIC = "Generic layout prepared by NEXUS — not a vendor import format. Check the target system's documentation before loading.";
/** Generic target layouts. Vendor-specific formats (Jedox, Agicap…) are deliberately not modelled here. */
export const TEMPLATES: TargetModel[] = [
  {
    id: "epm-fact", name: "EPM fact table", description: `One value per Entity × Account × Period × Scenario intersection, as loaded into planning or consolidation models. ${GENERIC}`,
    fields: [
      { name: "Entity", type: "text", required: true, role: "entity", aliases: ["company", "societe", "legal entity"] },
      { name: "Account", type: "text", required: true, role: "account", aliases: ["gl account", "compte"] },
      { name: "Period", type: "period", required: true, role: "period", aliases: ["month", "mois", "periode"] },
      { name: "Scenario", type: "text", required: true, role: "scenario", defaultConstant: "Actual" },
      { name: "Version", type: "text", required: false, role: "version" },
      { name: "Currency", type: "text", required: false, role: "currency", aliases: ["devise"] },
      { name: "CostCenter", type: "text", required: false, role: "costCenter", aliases: ["cost center", "centre de cout"] },
      { name: "Value", type: "number", required: true, role: "amount", aliases: ["amount", "montant"] }
    ]
  },
  {
    id: "general-ledger", name: "General ledger lines", description: `Journal lines with debit/credit or signed amounts, as extracted from an ERP. ${GENERIC}`,
    fields: [
      { name: "Entity", type: "text", required: false, role: "entity", aliases: ["company code", "societe"] },
      { name: "DocumentNumber", type: "text", required: false, role: "identifier", aliases: ["document", "piece", "journal entry"] },
      { name: "PostingDate", type: "date", required: true, role: "date", aliases: ["date", "posting date", "date comptable"] },
      { name: "Account", type: "text", required: true, role: "account", aliases: ["gl account", "compte"] },
      { name: "CostCenter", type: "text", required: false, role: "costCenter" },
      { name: "Description", type: "text", required: false, role: "description", aliases: ["libelle", "label"] },
      { name: "Debit", type: "number", required: false, role: "debit" },
      { name: "Credit", type: "number", required: false, role: "credit" },
      { name: "Amount", type: "number", required: false, role: "amount", aliases: ["montant"] },
      { name: "Currency", type: "text", required: true, role: "currency", aliases: ["devise"] }
    ]
  },
  {
    id: "cash-transactions", name: "Cash transactions", description: `Dated bank movements with a category, for cash-flow analysis and forecasting. ${GENERIC}`,
    fields: [
      { name: "Date", type: "date", required: true, role: "date", aliases: ["value date", "date valeur", "transaction date"] },
      { name: "Entity", type: "text", required: false, role: "entity" },
      { name: "BankAccount", type: "text", required: false, role: "dimension", aliases: ["bank account", "iban", "compte bancaire", "rib"] },
      { name: "Counterparty", type: "text", required: false, role: "counterparty", aliases: ["tiers", "customer", "supplier"] },
      { name: "Category", type: "text", required: false, role: "category", aliases: ["flux", "rubrique", "nature"] },
      { name: "Description", type: "text", required: false, role: "description", aliases: ["libelle", "label", "wording"] },
      { name: "Currency", type: "text", required: true, role: "currency", aliases: ["devise"] },
      { name: "Amount", type: "number", required: true, role: "amount", aliases: ["montant"] }
    ]
  }
];

const TRANSFORMS: Transform[] = ["trim", "uppercase", "lowercase", "number", "negate", "absolute", "date-iso", "period-month", "period-quarter", "period-year"];
const FIELD_TYPES: FieldType[] = ["text", "number", "date", "period"];

function resolveTarget(target: MappingRequest["target"]): TargetModel {
  if (typeof target === "string") {
    const template = TEMPLATES.find(t => t.id === target);
    if (!template) throw new FinanceError("UNKNOWN_TARGET", `Unknown template "${target}". Available: ${TEMPLATES.map(t => t.id).join(", ")}`);
    return template;
  }
  if (!target || typeof target !== "object" || !Array.isArray(target.fields) || !target.fields.length || target.fields.length > 50) {
    throw new FinanceError("INVALID_INPUT", "A custom target needs 1 to 50 fields");
  }
  const names = new Set<string>();
  for (const field of target.fields) {
    if (!field || typeof field.name !== "string" || !field.name.trim() || field.name.length > 80) throw new FinanceError("INVALID_INPUT", "Each target field needs a name (max 80 characters)");
    if (names.has(field.name)) throw new FinanceError("INVALID_INPUT", `Duplicate target field "${field.name}"`);
    if (!FIELD_TYPES.includes(field.type)) throw new FinanceError("INVALID_INPUT", `Field "${field.name}" has an unknown type`);
    if (field.allowedValues && (!Array.isArray(field.allowedValues) || field.allowedValues.length > 20_000)) throw new FinanceError("INVALID_INPUT", `Field "${field.name}" has too many allowed values`);
    names.add(field.name);
  }
  // Fields without a declared role get one from their name ("Month" → period, "Company" → entity) or their type.
  const role = (f: TargetField) => f.role ?? nameMatch(f.name)?.role ?? (f.type === "period" ? "period" : f.type === "date" ? "date" : undefined);
  return {
    id: String(target.id || "custom"), name: String(target.name || "Custom target"), description: String(target.description || ""),
    fields: target.fields.map(f => { const inferred = role(f); return { ...f, required: !!f.required, ...(inferred ? { role: inferred } : {}) }; })
  };
}

// ── Suggestions ────────────────────────────────────────────────────────────────
const bigrams = (text: string) => { const s = text.replace(/ /g, ""); return new Set(Array.from({ length: Math.max(0, s.length - 1) }, (_, i) => s.slice(i, i + 2))); };
function dice(a: string, b: string): number {
  const x = bigrams(a), y = bigrams(b);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const g of x) if (y.has(g)) shared++;
  return 2 * shared / (x.size + y.size);
}
const compatible = (field: TargetField, column: ColumnProfile) =>
  field.type === "text" || column.valueType === "empty" ? true
  : field.type === "number" ? column.valueType === "number"
  : field.type === "date" ? column.valueType === "date"
  : column.valueType === "period" || column.valueType === "date";

export function scoreColumn(field: TargetField, column: ColumnProfile): { score: number; reason: string } {
  const name = normalizeKey(column.name), target = normalizeKey(field.name.replace(/([a-z])([A-Z])/g, "$1 $2"));
  const reasons: string[] = [];
  let score = 0;
  if (field.role && column.role === field.role) { score += 0.55; reasons.push(`detected as ${column.role}`); }
  if (name === target) { score += 0.45; reasons.push("same name"); }
  else if (field.aliases?.some(alias => { const a = normalizeKey(alias); return name === a || ` ${name} `.includes(` ${a} `); })) { score += 0.35; reasons.push("known synonym"); }
  else { const similarity = dice(name, target); if (similarity >= 0.5) { score += 0.25 * similarity; reasons.push("similar name"); } }
  if (!compatible(field, column)) { score -= 0.5; reasons.push(`${column.valueType} values for a ${field.type} field`); }
  return { score: Math.round(score * 100) / 100, reason: reasons.join(", ") || "no match" };
}
const confidenceOf = (score: number): Confidence => score >= 0.8 ? "high" : score >= 0.55 ? "medium" : "low";

function autoTransforms(field: TargetField, column?: ColumnProfile): Transform[] {
  if (field.type === "number") return ["number"];
  if (field.type === "date") return ["date-iso"];
  if (field.type === "period") {
    const granularity = column?.periods?.granularity;
    return [granularity === "quarter" ? "period-quarter" : granularity === "year" ? "period-year" : "period-month"];
  }
  return column?.role === "currency" ? ["trim", "uppercase"] : ["trim"];
}

// ── Transformation ─────────────────────────────────────────────────────────────
type Context = { decimal: DecimalSeparator; dateOrders: Map<number, DateOrder> };
const failed = Symbol("failed");
function transform(raw: string, transforms: Transform[], context: Context, dateOrder: DateOrder): string | null | typeof failed {
  let value: string | null = raw, canonical = false;
  for (const t of transforms) {
    if (value === null) return null;
    switch (t) {
      case "trim": value = value.trim(); break;
      case "uppercase": value = value.toUpperCase(); break;
      case "lowercase": value = value.toLowerCase(); break;
      case "number": case "negate": case "absolute": {
        // After a numeric step the value is canonical ("-1250.50"); before it, use the dataset's separator.
        const parsed = parseAmount(value, canonical ? "." : context.decimal);
        if (parsed === null) { value = null; break; }
        if (parsed === undefined) return failed;
        const amount = t === "negate" ? -parsed.value : t === "absolute" && parsed.value < 0n ? -parsed.value : parsed.value;
        value = formatAmount(amount, Math.max(2, parsed.decimals));
        canonical = true;
        break;
      }
      case "date-iso": {
        if (!value.trim()) { value = null; break; }
        const date = parseDate(value, dateOrder);
        if (!date) return failed;
        value = date.iso; break;
      }
      case "period-month": case "period-quarter": case "period-year": {
        if (!value.trim()) { value = null; break; }
        const granularity = t === "period-month" ? "month" : t === "period-quarter" ? "quarter" : "year";
        const date = parseDate(value, dateOrder);
        if (date) { value = periodFromDate(date.iso, granularity); break; }
        const period = parsePeriod(value, true);
        if (!period) return failed;
        if (period.granularity === granularity) value = period.key;
        else if (period.granularity === "month" && granularity !== "month") value = periodFromDate(period.key + "-01", granularity);
        else if (period.granularity === "quarter" && granularity === "year") value = period.key.slice(0, 4);
        else return failed;
        break;
      }
    }
  }
  return value === "" ? null : value;
}

const csvCell = (value: string | null | undefined) => value === null || value === undefined ? "" : /[",\r\n]/.test(value) || /^\s|\s$/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
const csvLine = (cells: (string | null | undefined)[]) => cells.map(csvCell).join(",");

export function prepareFinanceMapping(request: MappingRequest): FinanceMapping {
  if (!request || typeof request !== "object") throw new FinanceError("INVALID_INPUT", "Invalid mapping request");
  const table = loadDataset(request.dataset);
  const target = resolveTarget(request.target);
  const columns = analyzeTable(table).columns.map(c => c.profile);
  const log = new IssueLog();
  const previewRows = Math.min(Math.max(Number.isInteger(request.previewRows) ? request.previewRows! : 10, 1), 50);

  const provided = new Map<string, FieldMapping>();
  for (const mapping of request.mappings ?? []) {
    if (!target.fields.some(f => f.name === mapping?.target)) throw new FinanceError("INVALID_INPUT", `Unknown target field "${mapping?.target}"`);
    if (mapping.source) columnIndex(table, mapping.source);
    if (mapping.subtract) columnIndex(table, mapping.subtract);
    if (mapping.transforms?.some(t => !TRANSFORMS.includes(t))) throw new FinanceError("INVALID_INPUT", `Unknown transform in "${mapping.target}"`);
    if (mapping.constant !== undefined && (typeof mapping.constant !== "string" || mapping.constant.length > 200)) throw new FinanceError("INVALID_INPUT", "Constants are limited to 200 characters");
    provided.set(mapping.target, mapping);
  }

  // Candidate scores for every field, then a greedy one-to-one assignment for fields the user did not map.
  const scored = new Map(target.fields.map(field => [field.name, columns.map(column => ({ column, ...scoreColumn(field, column) })).sort((a, b) => b.score - a.score)]));
  const used = new Set([...provided.values()].flatMap(m => [m.source, m.subtract].filter((s): s is string => !!s)));
  const assigned = new Map<string, { column: ColumnProfile; score: number; reason: string }>();
  const pairs = target.fields.filter(f => !provided.has(f.name)).flatMap(f => scored.get(f.name)!.map(s => ({ field: f, ...s }))).sort((a, b) => b.score - a.score);
  for (const pair of pairs) {
    if (pair.score < 0.35 || assigned.has(pair.field.name) || used.has(pair.column.name)) continue;
    assigned.set(pair.field.name, pair); used.add(pair.column.name);
  }

  const debit = columns.find(c => c.role === "debit"), credit = columns.find(c => c.role === "credit");
  const mappings: MappedField[] = target.fields.map(field => {
    const candidates = scored.get(field.name)!.filter(s => s.score >= 0.2).slice(0, 3).map(s => ({ source: s.column.name, score: s.score }));
    const user = provided.get(field.name);
    if (user) {
      const column = columns.find(c => c.name === user.source);
      return { ...user, transforms: user.transforms ?? (user.source ? autoTransforms(field, column) : []), origin: "user", confidence: "high", reason: "set by user", candidates, errors: 0 };
    }
    const match = assigned.get(field.name);
    if (match) return { target: field.name, source: match.column.name, transforms: autoTransforms(field, match.column), origin: "suggested", confidence: confidenceOf(match.score), reason: match.reason, candidates, errors: 0 };
    if (field.type === "number" && field.role === "amount" && debit && credit && !used.has(debit.name) && !used.has(credit.name)) {
      used.add(debit.name); used.add(credit.name);
      return { target: field.name, source: debit.name, subtract: credit.name, transforms: ["number"], origin: "suggested", confidence: "medium", reason: `${field.name} = ${debit.name} − ${credit.name}`, candidates, errors: 0 };
    }
    const dateColumn = field.type === "period" ? columns.find(c => c.role === "date") : undefined;
    if (dateColumn) return { target: field.name, source: dateColumn.name, transforms: ["period-month"], origin: "suggested", confidence: "medium", reason: `derived from dates in ${dateColumn.name}`, candidates, errors: 0 };
    if (field.defaultConstant) return { target: field.name, constant: field.defaultConstant, transforms: [], origin: "default", confidence: "low", reason: "no matching column: default constant", candidates, errors: 0 };
    return { target: field.name, transforms: [], origin: "none", confidence: "none", reason: "no matching column", candidates, errors: 0 };
  });

  // Apply the mapping to every row: counts conversion errors and missing required values.
  const context: Context = { decimal: table.decimal, dateOrders: new Map() };
  const orderOf = (index: number) => {
    if (!context.dateOrders.has(index)) context.dateOrders.set(index, detectDateOrder(table.rows.map(r => r[index] ?? "")).order);
    return context.dateOrders.get(index)!;
  };
  const plans = mappings.map(m => ({ mapping: m, field: target.fields.find(f => f.name === m.target)!, index: m.source ? table.headers.indexOf(m.source) : -1, subtract: m.subtract ? table.headers.indexOf(m.subtract) : -1, errorRows: [] as number[], missingRows: [] as number[], values: new Map<string, number>() }));
  const output: (string | null)[][] = [];
  table.rows.forEach((row, r) => {
    const line = plans.map(plan => {
      let value: string | null | typeof failed;
      if (plan.index < 0) value = plan.mapping.constant?.trim() ? plan.mapping.constant : null;
      else if (plan.subtract >= 0) {
        const a = parseAmount(row[plan.index] ?? "", table.decimal), b = parseAmount(row[plan.subtract] ?? "", table.decimal);
        if (a === undefined || b === undefined) value = failed;
        else if (a === null && b === null) value = null;
        else {
          const difference = formatAmount((a?.value ?? 0n) - (b?.value ?? 0n), Math.max(2, a?.decimals ?? 0, b?.decimals ?? 0));
          value = transform(difference, plan.mapping.transforms, { ...context, decimal: "." }, "dmy");
        }
      } else value = transform(row[plan.index] ?? "", plan.mapping.transforms, context, orderOf(plan.index));
      if (value === failed) { plan.errorRows.push(r + 1); return null; }
      if (value === null && plan.field.required) plan.missingRows.push(r + 1);
      if (value !== null && plan.field.allowedValues) plan.values.set(value, (plan.values.get(value) ?? 0) + 1);
      return value;
    });
    output.push(line);
  });

  const valueChecks: ValueMappingCheck[] = [];
  for (const plan of plans) {
    plan.mapping.errors = plan.errorRows.length;
    const label = plan.mapping.subtract ? `${plan.mapping.source} − ${plan.mapping.subtract}` : plan.mapping.source;
    if (plan.errorRows.length) log.add("error", "TRANSFORM_ERRORS", `${plan.errorRows.length} value(s) from "${label}" could not be converted to ${plan.field.type} for ${plan.field.name}`, { column: plan.mapping.source, rows: plan.errorRows });
    if (plan.missingRows.length && (plan.index >= 0 || plan.mapping.constant)) log.add("error", "MISSING_REQUIRED_VALUES", `${plan.missingRows.length} row(s) have no value for required field ${plan.field.name}`, { column: plan.mapping.source, rows: plan.missingRows });
    if (plan.mapping.origin === "suggested" && plan.mapping.confidence === "low") log.add("info", "LOW_CONFIDENCE", `${plan.field.name} ← ${plan.mapping.source}: weak match, please confirm`);
    if (plan.field.allowedValues?.length) {
      const allowed = new Set(plan.field.allowedValues.map(v => v.toLowerCase()));
      const unknown = [...plan.values].filter(([value]) => !allowed.has(value.toLowerCase())).sort((a, b) => b[1] - a[1]).slice(0, 50)
        .map(([value, count]) => { const suggestion = closest(value, plan.field.allowedValues!); return suggestion ? { value, count, suggestion } : { value, count }; });
      if (unknown.length) {
        valueChecks.push({ target: plan.field.name, unknown });
        log.add("warning", "UNKNOWN_TARGET_VALUES", `${unknown.length} value(s) for ${plan.field.name} are not allowed by the target`);
      }
    }
  }
  const unmappedRequired = mappings.filter(m => !m.source && !m.constant && target.fields.find(f => f.name === m.target)!.required).map(m => m.target);
  for (const field of unmappedRequired) log.add("error", "UNMAPPED_REQUIRED", `Required field ${field} has no source column or constant`);
  const sources = new Set(mappings.flatMap(m => [m.source, m.subtract].filter(Boolean)));
  const header = target.fields.map(f => f.name);
  const exportable = mappings.map(({ target: t, source, subtract, constant, transforms }) => ({ target: t, ...(source ? { source } : {}), ...(subtract ? { subtract } : {}), ...(constant ? { constant } : {}), transforms }));
  return {
    target, rowCount: table.rows.length, mappings, unmappedRequired, unusedColumns: table.headers.filter(h => !sources.has(h)), valueChecks,
    issues: log.issues, complete: !unmappedRequired.length && !log.issues.some(i => i.severity === "error"),
    preview: { columns: header, rows: output.slice(0, previewRows) },
    exports: {
      mappingCsv: [csvLine(["target", "required", "source", "subtract", "constant", "transforms", "confidence", "origin"]),
        ...mappings.map(m => csvLine([m.target, String(target.fields.find(f => f.name === m.target)!.required), m.source, m.subtract, m.constant, m.transforms.join("|"), m.confidence, m.origin]))].join("\n") + "\n",
      mappingJson: JSON.stringify({ target: typeof request.target === "string" ? request.target : target, mappings: exportable }, null, 2),
      ...(request.includeData ? { dataCsv: [csvLine(header), ...output.map(csvLine)].join("\n") + "\n" } : {})
    }
  };
}
