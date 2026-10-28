# Finance Solutions — v0.7

## Scope
Quality checks and integration-mapping preparation for financial datasets (ERP extracts, general ledgers, EPM loads, bank movements). One shared package, `@nexus/finance-solutions`, serves the Fastify API, the MCP server and (type-only) the React workspace. Every result is deterministic; no paid AI API is involved.

**Stateless by design.** The dataset travels with each request and is processed in memory. NEXUS stores neither the data nor the mappings: exports are downloaded by the user.

**No proprietary formats.** Jedox, Agicap or other vendor import formats are not modelled. The mapping templates are generic layouts and say so. Vendor connectors will only be built from verified documentation.

## Input
- CSV with a header row (delimiter auto-detected among `,` `;` tab `|`, or forced), or a JSON array of objects (an object holding a single array is accepted; nested objects are flattened as `a.b`).
- Up to 5 million characters, 100,000 rows and 200 columns.
- Decimal separator auto-detected (`1 250,50` vs `1,250.50`) by voting on number-shaped values, or forced. A `;`-delimited file defaults to a comma decimal.
- The web app re-decodes files as Windows-1252 when they are not valid UTF-8 (legacy ERP exports).
- The CSV parser is the Integration Hub's (`parseCsv`, now exported), so both modules share quoting and validation rules.

## Analysis — `analyze_financial_dataset`
**Column roles** come from the column name (English, French and common SAP field names: *montant, débit, crédit, société, compte, centre de coût, devise, libellé, BUKRS, HKONT, KOSTL…*) combined with the values. Each role carries a confidence (`high` when name and values agree) and a reason.

Roles: amount, debit, credit, date, period, currency, entity, account, costCenter, scenario, version, counterparty, category, description, identifier, dimension, other.

**Value parsing**
- Amounts: `1 250,50`, `1.250,50`, `1,250.50`, `(1 250.00)` (negative), `1250-` (SAP trailing minus), `-12.5 EUR`, `€ 99`, `1'250.00`. Sums use BigInt (6 decimals), so totals and balances are exact.
- Dates: ISO, `yyyymmdd`, `dd/mm/yyyy`, `mm/dd/yyyy`, `dd.mm.yy`. Day/month order is decided per column; when undecidable it is read as day/month and flagged.
- Periods: `2026-01`, `202601`, `01/2026`, `2026-P03`, `P03 2026`, `2026Q1`, `T1 2026`, `Jan 2026`, `janv. 2026`, `FY2026`, and `2026` in a period column.
- Currencies: ISO 4217 active codes, with withdrawn codes (BGN, HRK, ANG, SLL…) distinguished.

**Checks**

| Code | Severity |
|---|---|
| `MISSING_VALUES` (amount, account, entity, date, period; currency → warning) | error |
| `INVALID_AMOUNT`, `INVALID_DATE`, `INVALID_PERIOD`, `INVALID_CURRENCY` | error |
| `UNKNOWN_CURRENCY`, `CURRENCY_CASE`, `MIXED_DATE_FORMATS`, `MIXED_PERIOD_GRANULARITY`, `PERIOD_GAPS` | warning |
| `INCONSISTENT_VALUES` — codes differing only by case, spaces or accents (`FR01` / `fr01 `) | warning |
| `DUPLICATE_ROWS` (exact duplicates) | warning |
| `DUPLICATE_KEYS` — same dimension combination twice: warning for aggregated data, info when the file has descriptions or document numbers (transactional lines repeat keys legitimately) | warning / info |
| `UNBALANCED` — debit and credit totals differ (single-currency files) | warning |
| `NO_AMOUNT_COLUMN`, `EMPTY_DATASET` | warning / error |
| `MULTIPLE_CURRENCIES`, `WITHDRAWN_CURRENCY`, `AMBIGUOUS_DATE_ORDER`, `ZERO_AMOUNTS`, `ACCOUNT_CODE_LENGTHS`, `SURROUNDING_SPACES` | info |

Totals are reported per amount column and per currency, and are never summed across currencies. Row numbers are 1-based data rows (header excluded); up to 10 are listed per issue, with the total count.

## Dimensions — `validate_financial_dimensions`
Rules: `{ column, dimension?, required?, allowedValues?, format?, caseSensitive?, minLength?, maxLength?, label? }`.
- `format`: `any`, `iso-currency`, `period`, `date`, `numeric`, `alphanumeric`. These are fixed checks; user-supplied regular expressions are not accepted, which avoids ReDoS through the API or MCP.
- `allowedValues` is the reference list (master data, up to 20,000 values). Unknown values come with a *did you mean* suggestion: bounded edit distance, ties broken by the longest common prefix.
- Without rules, dimensions are inferred from the detected roles (entity, account, cost center, period, scenario, version, currency).
- Per dimension the result gives distinct values, missing rows, invalid formats, unknown values and a `valid` flag.

## Mapping — `prepare_finance_mapping`
**Targets**: `epm-fact` (Entity, Account, Period, Scenario, Version, Currency, CostCenter, Value), `general-ledger`, `cash-transactions`, or a custom field list `{ name, type: text|number|date|period, required, role?, aliases?, allowedValues?, defaultConstant? }`. Custom fields without a role get one from their name (`Month` → period, `Company` → entity).

**Suggestions** score role match, name and synonyms, and type compatibility, then assign columns one-to-one, greedily. Other suggestions:
- `Value = Débit − Crédit` when debit and credit columns exist but no amount column.
- A period derived from a date column (`period-month`).
- A default constant (`Scenario = Actual`) when nothing matches.

Each mapping reports its confidence, reason and the top candidates.

**Transforms**: `trim`, `uppercase`, `lowercase`, `number` (canonical `-1250.50`), `negate`, `absolute`, `date-iso`, `period-month`, `period-quarter`, `period-year`.

**Overrides**: `mappings: [{ target, source?, subtract?, constant?, transforms? }]`. The `mappingJson` export uses this same format, so it can be sent back unchanged.

**Output**
- The mapping applied to every row: conversion errors with their rows, missing required values, and values not allowed by the target.
- A preview (10 rows by default, 50 at most) and a `complete` flag.
- Exports: mapping specification as CSV and JSON. With `includeData`, the whole transformed dataset as CSV (comma-delimited, point decimal, ISO dates).

## API
`apps/api/src/routes/finance.ts` — Fastify plugin under `/api/finance` with a scoped error handler.

| Route | Body |
|---|---|
| `GET /templates` | — |
| `POST /analyze` | `{ content, format?, delimiter?, decimalSeparator? }` |
| `POST /dimensions` | `{ dataset, rules? }` |
| `POST /mapping` | `{ dataset, target, mappings?, previewRows?, includeData? }` |

Errors return `400 { error, code }` with code `INVALID_INPUT`, `INVALID_DATASET`, `UNKNOWN_COLUMN` or `UNKNOWN_TARGET`. Unknown body properties are stripped. The API never reads files.

## MCP
`apps/mcp-server/src/tools/finance.ts`: `analyze_financial_dataset`, `validate_financial_dimensions`, `prepare_finance_mapping`. The dataset is passed as text in `content`. All three tools carry `readOnlyHint: true` and `openWorldHint: false`. The server exposes 14 tools and reports version `0.7.0`.

## Web workspace
`apps/web/src/modules/finance/`:
- **Dataset**: import a file, paste text or load a fictitious sample, and override the delimiter or decimal separator. The editor is hidden above 200,000 characters.
- **Data quality**: anomalies (icon + label + code, never color alone), exact totals, debit − credit balance, column roles with confidence.
- **Dimensions**: editable rules with pasted reference lists; results with suggestions.
- **Mapping**: target layout, source / subtract / constant / transform per field, confidence, checks, preview, and CSV/JSON/data downloads.

Visited tabs stay mounted, so rules and mapping choices survive tab switches. Shared helpers moved to `apps/web/src/services/format.ts`.

## Known limitations
- Single-file analysis: no join with master-data files, no multi-file reconciliation yet.
- No persistence of rules or mappings (export and re-import the JSON).
- Role detection is heuristic. Always review low-confidence roles and suggestions.
- Excel (`.xlsx`) is not read: export to CSV first.
- No currency conversion and no FX rates.
- No vendor-specific import formats (by design, see Scope).

## Verification
1. `pnpm install`, `pnpm build`, `pnpm test`, `pnpm typecheck`.
2. Finance Solutions → **Sample**: check the anomalies (invalid 31/02 date, `abc` credit, `fr01 `/`eur` inconsistencies) and the balanced debit/credit totals.
3. **Dimensions**: paste `FR01, IT01` for Société → `DE01` is unknown.
4. **Mapping** (EPM fact table): `Value = Débit − Crédit`, `Period` from dates, `Scenario = Actual`; change a transform and check the preview; download the three exports.
5. Import a real (anonymized) export of yours, including a Windows-1252 CSV.
6. Through an MCP client: call the three tools with a small CSV.
