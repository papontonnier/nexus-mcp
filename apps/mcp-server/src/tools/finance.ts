import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { analyzeFinancialDataset, FinanceError, prepareFinanceMapping, TEMPLATES, validateFinancialDimensions, type MappingRequest } from "@nexus/finance-solutions";

// Pure computations on the dataset passed in: nothing is read from or written to disk.
const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const dataset = {
  content: z.string().min(1).max(5_000_000).describe("Dataset as CSV text (with header row) or a JSON array of objects"),
  format: z.enum(["csv", "json", "auto"]).optional().describe("Default: auto-detected"),
  delimiter: z.string().length(1).optional().describe("CSV delimiter. Default: auto-detected among , ; tab |"),
  decimalSeparator: z.enum([".", ",", "auto"]).optional().describe("Default: auto-detected (\"1 250,50\" vs \"1,250.50\")")
};
const rule = z.object({
  column: z.string().min(1).max(200),
  dimension: z.enum(["entity", "account", "costCenter", "period", "scenario", "version", "currency", "custom"]).optional(),
  label: z.string().max(80).optional(),
  required: z.boolean().optional().describe("Default: true"),
  allowedValues: z.array(z.string().max(200)).max(20_000).optional().describe("Reference list (master data). Unknown values get a closest-match suggestion."),
  format: z.enum(["any", "iso-currency", "period", "date", "numeric", "alphanumeric"]).optional(),
  caseSensitive: z.boolean().optional(),
  minLength: z.number().int().min(0).max(200).optional(),
  maxLength: z.number().int().min(1).max(200).optional()
});
const transform = z.enum(["trim", "uppercase", "lowercase", "number", "negate", "absolute", "date-iso", "period-month", "period-quarter", "period-year"]);
const field = z.object({
  name: z.string().min(1).max(80), type: z.enum(["text", "number", "date", "period"]), required: z.boolean(),
  role: z.string().optional(), aliases: z.array(z.string().max(80)).max(20).optional(), description: z.string().max(300).optional(),
  allowedValues: z.array(z.string().max(200)).max(20_000).optional(), defaultConstant: z.string().max(200).optional()
});

async function run(task: () => unknown) {
  try { return { content: [{ type: "text" as const, text: JSON.stringify(await task(), null, 2) }] }; }
  catch (e) {
    const text = e instanceof FinanceError ? `${e.code}: ${e.message}` : String(e);
    return { isError: true, content: [{ type: "text" as const, text }] };
  }
}
const datasetOf = ({ content, format, delimiter, decimalSeparator }: { content: string; format?: "csv" | "json" | "auto"; delimiter?: string; decimalSeparator?: "." | "," | "auto" }) =>
  ({ content, format, delimiter, decimalSeparator });

export function registerFinanceTools(server: McpServer) {
  server.registerTool("analyze_financial_dataset", {
    title: "Analyze financial dataset",
    description: "Profile a financial CSV/JSON dataset: detects amount, debit/credit, date, period, currency, entity, account and cost-center columns (English and French names), parses FR/EN number formats exactly, and reports totals per currency, debit/credit balance, period gaps, duplicates, invalid values and inconsistent codes.",
    inputSchema: dataset, annotations
  }, async input => run(() => analyzeFinancialDataset(datasetOf(input))));

  server.registerTool("validate_financial_dimensions", {
    title: "Validate financial dimensions",
    description: "Check dimension columns (entity, account, cost center, period, scenario, version, currency…) for missing values, format errors and values absent from a reference list, with closest-match suggestions. Without rules, dimensions are inferred from the column roles.",
    inputSchema: { ...dataset, rules: z.array(rule).max(30).optional() }, annotations
  }, async ({ rules, ...input }) => run(() => validateFinancialDimensions({ dataset: datasetOf(input), rules })));

  server.registerTool("prepare_finance_mapping", {
    title: "Prepare finance mapping",
    description: `Suggest and test a source → target column mapping with deterministic transforms (number, negate, date-iso, period-month…, debit − credit). Targets: ${TEMPLATES.map(t => `"${t.id}" (${t.name})`).join(", ")} — generic layouts, not vendor import formats — or a custom field list. Returns suggestions with confidence, a preview, conversion errors and exportable mapping specs.`,
    inputSchema: {
      ...dataset,
      target: z.union([z.enum(TEMPLATES.map(t => t.id) as [string, ...string[]]), z.object({ id: z.string().max(64).optional(), name: z.string().max(80).optional(), description: z.string().max(500).optional(), fields: z.array(field).min(1).max(50) })]),
      mappings: z.array(z.object({ target: z.string(), source: z.string().optional(), subtract: z.string().optional(), constant: z.string().max(200).optional(), transforms: z.array(transform).optional() })).max(50).optional()
        .describe("Explicit choices that override suggestions for these target fields"),
      previewRows: z.number().int().min(1).max(50).optional(),
      includeData: z.boolean().optional().describe("Also return the full transformed dataset as CSV (can be large)")
    },
    annotations
  }, async ({ target, mappings, previewRows, includeData, ...input }) =>
    run(() => prepareFinanceMapping({ dataset: datasetOf(input), target: target as MappingRequest["target"], mappings, previewRows, includeData })));
}
