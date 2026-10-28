import { analyzeDataStructure } from "@nexus/integration-hub";
import { analyzeCsv } from "@nexus/integration-hub/csv";
import { compareJsonSchemas } from "@nexus/integration-hub/compare";
import { KnowledgeStore } from "@nexus/knowledge-engine";
import { DeveloperToolkit } from "@nexus/developer-toolkit";
import { analyzeFinancialDataset, prepareFinanceMapping, validateFinancialDimensions, type DimensionRule, type FieldMapping } from "@nexus/finance-solutions";
import type { ParamType, ToolParam, ToolSpec } from "./types.js";

export type ToolDefinition = ToolSpec & { run: (input: Record<string, unknown>) => Promise<unknown> | unknown };
export class StepError extends Error {}

const p = (name: string, type: ParamType, required: boolean, description: string): ToolParam => ({ name, type, required, description });
const str = (input: Record<string, unknown>, key: string) => input[key] === undefined || input[key] === null ? undefined : String(input[key]);
const json = (value: unknown, label: string) => {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { throw new StepError(`${label} is not valid JSON`); }
};

/** Column or field names from a list, a comma/newline separated string, or an analysis result (CSV columns, JSON fields, finance columns). */
export function namesOf(value: unknown): string[] {
  if (typeof value === "string") return value.split(/[\n,;]+/).map(v => v.trim()).filter(Boolean);
  if (Array.isArray(value)) return value.map(v => typeof v === "string" ? v : v && typeof v === "object" && "name" in v ? String(v.name) : String(v)).filter(Boolean);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.columns)) return namesOf(record.columns);
    if (Array.isArray(record.fields)) return (record.fields as { path?: string }[]).map(f => String(f.path ?? "")).filter(path => path && path !== "$");
  }
  return [];
}
const normalize = (name: string) => name.trim().toLowerCase();

const CORE: ToolDefinition[] = [
  {
    id: "core.check_columns", module: "Core", title: "Check required columns", sensitive: false,
    description: "Verify that required columns or fields exist. Accepts a list or the output of an analysis step. Fails the step when columns are missing unless failOnMissing is false.",
    params: [p("available", "json", true, "Analysis output or list of names"), p("required", "string[]", true, "Expected names"), p("failOnMissing", "boolean", false, "Default true")],
    run: input => {
      const available = namesOf(input.available), keys = new Set(available.map(normalize));
      const required = namesOf(input.required);
      const missing = required.filter(name => !keys.has(normalize(name))), present = required.filter(name => keys.has(normalize(name)));
      if (missing.length && input.failOnMissing !== false) throw new StepError(`Missing column(s): ${missing.join(", ")}`);
      return { ok: !missing.length, present, missing, available };
    }
  },
  {
    id: "core.compare_columns", module: "Core", title: "Compare with target columns", sensitive: false,
    description: "Compare source columns with a target list: matching, missing in source and extra columns (case-insensitive).",
    params: [p("source", "json", true, "Analysis output or list of source names"), p("target", "string[]", true, "Target column names")],
    run: input => {
      const source = namesOf(input.source), target = namesOf(input.target);
      const sourceKeys = new Set(source.map(normalize)), targetKeys = new Set(target.map(normalize));
      return {
        matching: target.filter(t => sourceKeys.has(normalize(t))), missingInSource: target.filter(t => !sourceKeys.has(normalize(t))),
        extraInSource: source.filter(s => !targetKeys.has(normalize(s))), coverage: target.length ? Math.round(target.filter(t => sourceKeys.has(normalize(t))).length / target.length * 100) : 100
      };
    }
  },
  {
    id: "core.assert", module: "Core", title: "Assert a condition", sensitive: false,
    description: "Stop the workflow with a message when a value does not satisfy a comparison (eq, ne, gt, gte, lt, lte, truthy, falsy).",
    params: [p("value", "json", true, "Value to test, usually a reference"), p("op", "string", true, "eq | ne | gt | gte | lt | lte | truthy | falsy"), p("expected", "json", false, "Comparison value"), p("message", "string", false, "Failure message")],
    run: input => {
      const { value, expected } = input, op = String(input.op);
      const n = (v: unknown) => Number(v);
      const ok = op === "eq" ? String(value) === String(expected) : op === "ne" ? String(value) !== String(expected)
        : op === "gt" ? n(value) > n(expected) : op === "gte" ? n(value) >= n(expected) : op === "lt" ? n(value) < n(expected) : op === "lte" ? n(value) <= n(expected)
        : op === "truthy" ? (Array.isArray(value) ? value.length > 0 : !!value) : op === "falsy" ? (Array.isArray(value) ? value.length === 0 : !value)
        : (() => { throw new StepError(`Unknown operator "${op}"`); })();
      if (!ok) throw new StepError(str(input, "message") || `Assertion failed: ${JSON.stringify(value)} ${op} ${JSON.stringify(expected)}`);
      return { ok: true, value };
    }
  },
  {
    id: "core.report", module: "Core", title: "Generate a report", sensitive: false,
    description: "Build a Markdown report. References in the template ({{steps.id.output…}}) are replaced; objects are rendered as JSON.",
    params: [p("title", "string", true, "Report title"), p("template", "string", true, "Markdown body with references")],
    run: input => ({ markdown: `# ${str(input, "title")}\n\n${str(input, "template") ?? ""}`.trim() + "\n" })
  }
];

export function createNexusCatalog(services: { knowledge?: KnowledgeStore; developer?: DeveloperToolkit } = {}): ToolDefinition[] {
  const knowledge = services.knowledge ?? new KnowledgeStore();
  const developer = services.developer ?? new DeveloperToolkit();
  const dataset = (input: Record<string, unknown>) => ({ content: String(input.content ?? ""), delimiter: str(input, "delimiter"), decimalSeparator: str(input, "decimalSeparator") as "." | "," | "auto" | undefined });
  return [
    ...CORE,
    { id: "integration.analyze_json", module: "Integration Hub", title: "Analyze JSON structure", sensitive: false, description: "Field paths, types and nullability of a JSON document.",
      params: [p("json", "json", true, "JSON document (text or value)")], run: input => analyzeDataStructure(json(input.json, "json")) },
    { id: "integration.analyze_csv", module: "Integration Hub", title: "Analyze CSV", sensitive: false, description: "Columns, inferred types, missing values and examples of a CSV document.",
      params: [p("csv", "string", true, "CSV text with a header row"), p("delimiter", "string", false, "Single character, default ,")],
      run: input => analyzeCsv(String(input.csv ?? ""), str(input, "delimiter") || ",") },
    { id: "integration.compare_json_schemas", module: "Integration Hub", title: "Compare JSON schemas", sensitive: false, description: "Added, removed and retyped fields between two representative JSON documents.",
      params: [p("source", "json", true, "Source JSON"), p("target", "json", true, "Target JSON")],
      run: input => compareJsonSchemas(json(input.source, "source"), json(input.target, "target")) },
    { id: "knowledge.search", module: "Knowledge Engine", title: "Search knowledge", sensitive: false, description: "Keyword search across local documents.",
      params: [p("query", "string", true, "2–250 characters"), p("limit", "number", false, "Default 10")],
      run: input => knowledge.search(String(input.query ?? ""), Number(input.limit ?? 10)) },
    { id: "knowledge.get_document", module: "Knowledge Engine", title: "Read document", sensitive: false, description: "Content and metadata of a local document.",
      params: [p("id", "string", true, "Document ID"), p("version", "number", false, "Earlier version")],
      run: input => knowledge.get(String(input.id ?? ""), input.version === undefined ? undefined : Number(input.version)) },
    { id: "knowledge.import_document", module: "Knowledge Engine", title: "Save to knowledge base", sensitive: true,
      description: "Write a Markdown or text document (for example a generated report) into the local knowledge base. Changes local data: requires confirmation.",
      params: [p("name", "string", true, "File name ending in .md or .txt"), p("content", "string", true, "Document text"), p("documentId", "string", false, "Existing document to version")],
      run: input => {
        const name = String(input.name ?? "");
        if (!/\.(md|txt)$/i.test(name)) throw new StepError("Workflows can only save .md or .txt documents");
        return knowledge.import(name, Buffer.from(String(input.content ?? ""), "utf8"), str(input, "documentId"));
      } },
    { id: "developer.inspect_project", module: "Developer Toolkit", title: "Inspect project", sensitive: false, description: "Languages, frameworks and tooling of an allowed project.",
      params: [p("projectId", "string", true, "Allowed project ID")], run: input => developer.inspectProject(String(input.projectId ?? "")) },
    { id: "developer.analyze_dependencies", module: "Developer Toolkit", title: "Analyze dependencies", sensitive: false, description: "Declared dependencies of an allowed project.",
      params: [p("projectId", "string", true, "Allowed project ID")], run: input => developer.analyzeDependencies(String(input.projectId ?? "")) },
    { id: "developer.get_project_structure", module: "Developer Toolkit", title: "Project structure", sensitive: false, description: "Directory tree or file search in an allowed project (metadata only).",
      params: [p("projectId", "string", true, "Allowed project ID"), p("path", "string", false, "Relative folder"), p("depth", "number", false, "1–5"), p("query", "string", false, "Name filter"), p("extensions", "string[]", false, "e.g. ts, java")],
      run: input => developer.getProjectStructure(String(input.projectId ?? ""), {
        path: str(input, "path"), depth: input.depth === undefined ? undefined : Number(input.depth), query: str(input, "query"),
        extensions: input.extensions === undefined ? undefined : namesOf(input.extensions)
      }) },
    { id: "finance.analyze_dataset", module: "Finance Solutions", title: "Analyze financial dataset", sensitive: false, description: "Roles, exact totals, balance and anomalies of a financial CSV/JSON dataset.",
      params: [p("content", "string", true, "CSV or JSON text"), p("delimiter", "string", false, "Default auto"), p("decimalSeparator", "string", false, ". , or auto")],
      run: input => analyzeFinancialDataset(dataset(input)) },
    { id: "finance.validate_dimensions", module: "Finance Solutions", title: "Validate dimensions", sensitive: false, description: "Missing, invalid and unknown dimension values; rules inferred when omitted.",
      params: [p("content", "string", true, "CSV or JSON text"), p("rules", "json", false, "Dimension rules")],
      run: input => validateFinancialDimensions({ dataset: dataset(input), rules: input.rules === undefined ? undefined : json(input.rules, "rules") as DimensionRule[] }) },
    { id: "finance.prepare_mapping", module: "Finance Solutions", title: "Prepare finance mapping", sensitive: false, description: "Suggested and tested mapping to epm-fact, general-ledger or cash-transactions.",
      params: [p("content", "string", true, "CSV or JSON text"), p("target", "string", true, "Template ID"), p("mappings", "json", false, "Overrides")],
      run: input => prepareFinanceMapping({ dataset: dataset(input), target: String(input.target ?? ""), mappings: input.mappings === undefined ? undefined : json(input.mappings, "mappings") as FieldMapping[] }) }
  ];
}
