import type { WorkflowDefinition } from "./types.js";

/** Read-only workflows shipped with NEXUS. Users duplicate them to customize. */
export const BUILT_IN_WORKFLOWS: WorkflowDefinition[] = [
  {
    id: "csv-integration-check", name: "CSV integration check",
    description: "Analyze a CSV file, check required columns, compare it with a target structure and produce a report.",
    inputs: [
      { name: "csv", label: "CSV file", type: "text", required: true, multiline: true, description: "CSV text with a header row" },
      { name: "delimiter", label: "Delimiter", type: "text", required: false, default: "," },
      { name: "requiredColumns", label: "Required columns", type: "list", required: true, default: ["invoice_id", "amount", "currency"] },
      { name: "targetColumns", label: "Target columns", type: "list", required: true, default: ["invoice_id", "amount", "currency", "status", "due_date"] }
    ],
    steps: [
      { id: "analyze", tool: "integration.analyze_csv", label: "Analyze structure", input: { csv: "{{inputs.csv}}", delimiter: "{{inputs.delimiter}}" } },
      { id: "check", tool: "core.check_columns", label: "Check required columns", input: { available: "{{steps.analyze.output}}", required: "{{inputs.requiredColumns}}", failOnMissing: false } },
      { id: "compare", tool: "core.compare_columns", label: "Compare with target", input: { source: "{{steps.analyze.output}}", target: "{{inputs.targetColumns}}" } },
      { id: "report", tool: "core.report", label: "Generate report", input: {
        title: "CSV integration check",
        template: "- Rows: {{steps.analyze.output.rowCount}}\n- Required columns present: {{steps.check.output.ok}}\n- Missing required: {{steps.check.output.missing}}\n- Target coverage: {{steps.compare.output.coverage}}%\n- Missing in source: {{steps.compare.output.missingInSource}}\n- Extra in source: {{steps.compare.output.extraInSource}}\n\n## Columns\n{{steps.analyze.output.columns}}"
      } }
    ]
  },
  {
    id: "finance-dataset-review", name: "Financial dataset review",
    description: "Profile a financial dataset, validate its dimensions, prepare an EPM mapping and stop if blocking errors remain.",
    inputs: [{ name: "dataset", label: "Dataset (CSV or JSON)", type: "text", required: true, multiline: true }],
    steps: [
      { id: "analyze", tool: "finance.analyze_dataset", label: "Analyze dataset", input: { content: "{{inputs.dataset}}" } },
      { id: "dimensions", tool: "finance.validate_dimensions", label: "Validate dimensions", input: { content: "{{inputs.dataset}}" }, continueOnError: true },
      { id: "mapping", tool: "finance.prepare_mapping", label: "Prepare EPM mapping", input: { content: "{{inputs.dataset}}", target: "epm-fact" } },
      { id: "report", tool: "core.report", label: "Generate report", input: {
        title: "Financial dataset review",
        template: "- Rows: {{steps.analyze.output.rowCount}}\n- Errors: {{steps.analyze.output.summary.errors}} · warnings: {{steps.analyze.output.summary.warnings}}\n- Dimensions valid: {{steps.dimensions.output.valid}}\n- Mapping complete: {{steps.mapping.output.complete}}\n\n## Totals\n{{steps.analyze.output.totals}}\n\n## Anomalies\n{{steps.analyze.output.issues}}"
      } },
      { id: "gate", tool: "core.assert", label: "No blocking error", input: { value: "{{steps.analyze.output.summary.errors}}", op: "eq", expected: 0, message: "The dataset still contains blocking errors" } }
    ]
  },
  {
    id: "project-audit", name: "Project audit",
    description: "Inspect an allowed local project and its dependencies, then summarize the stack.",
    inputs: [{ name: "project", label: "Project", type: "project", required: true }],
    steps: [
      { id: "inspect", tool: "developer.inspect_project", label: "Inspect project", input: { projectId: "{{inputs.project}}" } },
      { id: "dependencies", tool: "developer.analyze_dependencies", label: "Analyze dependencies", input: { projectId: "{{inputs.project}}" } },
      { id: "report", tool: "core.report", label: "Generate report", input: {
        title: "Project audit",
        template: "{{steps.inspect.output.summary}}\n\n- Files: {{steps.inspect.output.stats.files}}\n- Dependencies: {{steps.dependencies.output.summary.total}} declared, {{steps.dependencies.output.summary.unique}} unique\n- By scope: {{steps.dependencies.output.summary.byScope}}"
      } }
    ]
  },
  {
    id: "csv-check-to-knowledge", name: "CSV check saved to knowledge base",
    description: "Run a CSV structure check and save the Markdown report into the Knowledge Engine. Writes local data: requires confirmation.",
    inputs: [
      { name: "csv", label: "CSV file", type: "text", required: true, multiline: true },
      { name: "reportName", label: "Report file name", type: "text", required: true, default: "csv-check.md" }
    ],
    steps: [
      { id: "analyze", tool: "integration.analyze_csv", label: "Analyze structure", input: { csv: "{{inputs.csv}}" } },
      { id: "report", tool: "core.report", label: "Generate report", input: { title: "CSV check", template: "- Rows: {{steps.analyze.output.rowCount}}\n\n{{steps.analyze.output.columns}}" } },
      { id: "save", tool: "knowledge.import_document", label: "Save report", input: { name: "{{inputs.reportName}}", content: "{{steps.report.output.markdown}}" } }
    ]
  }
];
