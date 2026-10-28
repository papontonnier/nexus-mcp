# Agent Lab — v0.8

## Scope
Deterministic workflows that chain NEXUS tools: a catalogue, a builder, bounded execution, a run history and manual re-runs. **No AI model is involved and no paid API is required.** Optional model integration can come later; it is not needed for any feature here.

The engine, `@nexus/agent-lab`, is independent of the frontend. The Fastify API and the MCP server both use it, each building the same tool catalog over its own Knowledge Engine and Developer Toolkit instances.

## Workflow model
```json
{
  "id": "my-check", "name": "My check", "description": "…",
  "inputs": [{ "name": "csv", "label": "CSV file", "type": "text", "required": true, "multiline": true }],
  "steps": [
    { "id": "analyze", "tool": "integration.analyze_csv", "input": { "csv": "{{inputs.csv}}" } },
    { "id": "check", "tool": "core.check_columns", "input": { "available": "{{steps.analyze.output}}", "required": ["amount"] }, "continueOnError": true },
    { "id": "report", "tool": "core.report", "input": { "title": "Check", "template": "Missing: {{steps.check.output.missing}}" },
      "when": { "ref": "steps.check.status", "op": "eq", "value": "succeeded" } }
  ]
}
```
- **Input types**: `text` (optionally `multiline`), `number`, `boolean`, `list` (comma- or newline-separated), `project` (an allowed Developer Toolkit project).
- **References**: `{{inputs.x}}` and `{{steps.<id>.output.path[0].field}}` / `{{steps.<id>.status}}`.
  - They are plain property lookups: no expression evaluation, and `__proto__`, `constructor` and `prototype` are refused.
  - A string made of a single reference keeps the value's type. Inside text, lists of plain values render as `a, b`, objects as indented JSON.
- **Conditions** (`when`): `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `truthy`, `falsy`, `exists`. A false condition skips the step.
- **Errors**: a failing step stops the run, and the remaining steps are marked skipped. With `continueOnError` the run goes on and ends as `completed_with_errors`.

## Safety and bounds
| Rule | Value |
|---|---|
| No loops, jumps or recursion | Steps run once, in order. A step may only reference inputs and **earlier** steps (checked on save and before every run), so a workflow is always a finite, acyclic sequence. |
| Steps per workflow | 25 |
| Step timeout / run timeout | 60 s / 5 min |
| Stored history | last 200 runs; step inputs/outputs above 200,000 characters are truncated in storage |
| Stored run inputs | up to 1 MB (larger inputs are not stored, and that run cannot be replayed) |
| Sensitive steps | Tools that change local data (`knowledge.import_document`) need `confirmSensitive: true`. The API answers `409 CONFIRMATION_REQUIRED` with the step names; the UI asks for a checkbox; MCP clients are told to ask the user first. |
| Built-in workflows | Read-only. Duplicate them to customize. |

## Tools available in workflows
| Module | Tools |
|---|---|
| Core | `core.check_columns`, `core.compare_columns`, `core.assert`, `core.report` (Markdown) |
| Integration Hub | `integration.analyze_json`, `integration.analyze_csv`, `integration.compare_json_schemas` |
| Knowledge Engine | `knowledge.search`, `knowledge.get_document`, `knowledge.import_document` (**sensitive**, `.md`/`.txt` only) |
| Developer Toolkit | `developer.inspect_project`, `developer.analyze_dependencies`, `developer.get_project_structure` (allowlist rules apply) |
| Finance Solutions | `finance.analyze_dataset`, `finance.validate_dimensions`, `finance.prepare_mapping` |

## Built-in workflows
- **CSV integration check** — the roadmap example: analyze, check the required columns, compare with the target columns, report.
- **Financial dataset review** — analysis, dimension validation, EPM mapping and report, then a gate that fails while blocking errors remain.
- **Project audit** — inspection and dependencies of an allowed project, with a summary.
- **CSV check saved to knowledge base** — saves the report into the Knowledge Engine (sensitive: needs confirmation).

## Storage
`.nexus/agent-lab/workflows/<id>.json` and `.nexus/agent-lab/runs/<uuid>.json`, ignored by Git. Override the location with `NEXUS_AGENT_LAB_DIR`. Run inputs can contain your data (CSV, financial datasets): they stay local, and deleting a run removes them.

## API — `/api/agents`
| Route | Purpose |
|---|---|
| `GET /tools` | Tool catalog with parameters and sensitivity |
| `GET /workflows`, `GET /workflows/:id` | Catalogue and definitions |
| `POST /workflows/validate` | `{ issues }` for a draft |
| `PUT /workflows/:id`, `DELETE /workflows/:id` | Save or delete user workflows |
| `POST /runs` | `{ workflowId, inputs, confirmSensitive? }` → run record |
| `GET /runs?workflowId&limit`, `GET /runs/:id`, `DELETE /runs/:id` | History |
| `POST /runs/:id/rerun` | Replay with the stored inputs |

Errors return `{ error, code }`: 400 `INVALID_WORKFLOW` (with `issues`) and `INVALID_INPUT`; 403 `READ_ONLY_WORKFLOW`; 404 `WORKFLOW_NOT_FOUND` and `RUN_NOT_FOUND`; 409 `CONFIRMATION_REQUIRED` (with `sensitiveSteps`) and `INPUTS_NOT_STORED`.

## MCP
`list_workflows`, `run_workflow`, `list_workflow_runs`, `get_workflow_run`. Only `run_workflow` is not read-only, because it records a run and may run confirmed sensitive steps. The server exposes 18 tools and reports version `0.8.0`.

## Web workspace — `apps/web/src/modules/agents/`
- **Catalogue**: built-in and user workflows, tool pipeline, *Writes data* badge, Run / Duplicate / Edit / Delete.
- **Run**: input form, confirmation checkbox for sensitive steps, step timeline with each step's input, output, error and duration, rendered report.
- **History**: status, start, duration and failed steps; open a run and re-run it.
- **Builder**: inputs, steps (tool picker grouped by module, typed parameters, references accepted), reordering, *continue on error*, *run only if…*, the references available at each step, and live validation that blocks saving until fixed.

## Known limitations
- Sequential steps only: no parallel branches and no loops (by design).
- Timeouts stop waiting for a step but cannot interrupt a computation already running in the same process.
- No scheduling: runs are started manually from the UI, the API or MCP.
- No AI-driven step yet.

## Verification
1. `pnpm install`, `pnpm build`, `pnpm test`, `pnpm typecheck`.
2. Agent Lab → run *CSV integration check* with the default inputs, then read the report and the step outputs.
3. Run *CSV check saved to knowledge base*: the button stays disabled until confirmed; the report then appears in the Knowledge Engine.
4. Duplicate a workflow, move the report step above the step it references (the builder shows the error), fix it and save.
5. History → open a run → **Re-run**.
6. Through an MCP client: `list_workflows`, then `run_workflow` (with and without `confirmSensitive` on the sensitive workflow).
