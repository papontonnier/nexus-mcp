import test from "node:test";
import assert from "node:assert/strict";
import { analyzeFinancialDataset, FinanceError, prepareFinanceMapping, validateFinancialDimensions, type FinanceIssue } from "./index.js";

const GL = [
  "Société;N° pièce;Date comptable;Compte;Centre de coût;Libellé;Débit;Crédit;Devise",
  "FR01;VE-1;05/01/2026;411000;CC100;Facture ACME;1 200,00;;EUR",
  "FR01;VE-1;05/01/2026;706000;CC100;Facture ACME;;1 000,00;EUR",
  "FR01;VE-1;05/01/2026;445710;CC100;TVA;;200,00;EUR",
  "fr01 ;BQ-7;03/03/2026;512000;;Encaissement;1 200,00;;eur",
  "FR01;BQ-7;03/03/2026;411000;;Encaissement;;1 200,00;EUR",
  "DE01;VE-9;31/02/2026;706000;CC300;Rechnung;;abc;XYZ"
].join("\n");
const EPM = JSON.stringify([
  { entity: "FR01", account: "6061", period: "2026-01", scenario: "Actual", amount: 100.5, currency: "EUR" },
  { entity: "FR01", account: "6061", period: "2026-01", scenario: "Actual", amount: 20, currency: "EUR" },
  { entity: "FR01", account: "6061", period: "2026-03", scenario: "Actual", amount: 10, currency: "EUR" },
  { entity: "FR01", account: "6061", period: "2026-03", scenario: "Actual", amount: 10, currency: "EUR" },
  { entity: "US01", account: "6061", period: "2026-01", scenario: "Budget", amount: 5, currency: "USD" }
]);
const codes = (issues: FinanceIssue[]) => issues.map(i => `${i.severity}:${i.code}`).sort();

test("analyzes a French GL export: roles, formats, balance and anomalies", () => {
  const analysis = analyzeFinancialDataset({ content: GL });
  assert.deepEqual([analysis.format, analysis.delimiter, analysis.decimalSeparator, analysis.rowCount], ["csv", ";", ",", 6]);
  assert.deepEqual(Object.fromEntries(analysis.columns.map(c => [c.name, c.role])), {
    "Société": "entity", "N° pièce": "identifier", "Date comptable": "date", "Compte": "account", "Centre de coût": "costCenter",
    "Libellé": "description", "Débit": "debit", "Crédit": "credit", "Devise": "currency"
  });
  assert.deepEqual(analysis.balance, { debit: "2400.00", credit: "2400.00", difference: "0.00", balanced: true });
  const date = analysis.columns.find(c => c.role === "date")!;
  assert.deepEqual([date.dates!.min, date.dates!.max, date.dates!.formats], ["2026-01-05", "2026-03-03", ["dd/mm/yyyy"]]);
  const issues = codes(analysis.issues);
  for (const code of ["error:INVALID_DATE", "error:INVALID_AMOUNT", "warning:UNKNOWN_CURRENCY", "warning:CURRENCY_CASE", "warning:INCONSISTENT_VALUES", "info:SURROUNDING_SPACES"]) {
    assert.ok(issues.includes(code), code);
  }
  assert.deepEqual(analysis.issues.find(i => i.code === "INVALID_DATE")!.rows, [6]);
  assert.equal(analysis.summary.errors, 2);
  // The only XYZ row has an invalid amount, so no XYZ total exists and no multi-currency notice is raised.
  assert.deepEqual(analysis.totals.map(t => t.currency), ["EUR", "EUR"]);
});

test("analyzes JSON EPM data: period gaps, duplicates and per-currency totals", () => {
  const analysis = analyzeFinancialDataset({ content: EPM });
  assert.deepEqual([analysis.format, analysis.decimalSeparator], ["json", "."]);
  const period = analysis.columns.find(c => c.role === "period")!;
  assert.deepEqual(period.periods, { min: "2026-01", max: "2026-03", granularity: "month", distinct: 2, gaps: ["2026-02"], invalid: 0 });
  assert.deepEqual(analysis.totals, [{ column: "amount", currency: "EUR", total: "140.50", rows: 4 }, { column: "amount", currency: "USD", total: "5.00", rows: 1 }]);
  assert.deepEqual([analysis.duplicates.exactRows, analysis.duplicates.duplicateKeys], [1, 1]);
  const issues = codes(analysis.issues);
  for (const code of ["warning:PERIOD_GAPS", "warning:DUPLICATE_ROWS", "warning:DUPLICATE_KEYS"]) assert.ok(issues.includes(code), code);
});

test("rejects invalid datasets with clear errors", () => {
  const code = (expected: string) => (e: unknown) => e instanceof FinanceError && e.code === expected;
  assert.throws(() => analyzeFinancialDataset({ content: "" }), code("INVALID_DATASET"));
  assert.throws(() => analyzeFinancialDataset({ content: "a,b\n1" }), code("INVALID_DATASET"));
  assert.throws(() => analyzeFinancialDataset({ content: "[1, 2]" }), code("INVALID_DATASET"));
  assert.throws(() => analyzeFinancialDataset({ content: "x".repeat(5_000_001) }), code("INVALID_DATASET"));
  assert.throws(() => validateFinancialDimensions({ dataset: { content: GL }, rules: [{ column: "Nope" }] }), code("UNKNOWN_COLUMN"));
  assert.throws(() => prepareFinanceMapping({ dataset: { content: GL }, target: "jedox-import" }), code("UNKNOWN_TARGET"));
});

test("validates dimensions against reference lists with suggestions", () => {
  const result = validateFinancialDimensions({ dataset: { content: GL }, rules: [
    { column: "Société", dimension: "entity", allowedValues: ["FR01", "IT01"] },
    { column: "Compte", dimension: "account", format: "numeric", minLength: 6, maxLength: 6 },
    { column: "Centre de coût", dimension: "costCenter", required: true, allowedValues: ["CC100", "CC200", "CC310"] },
    { column: "Devise", dimension: "currency" }
  ] });
  assert.equal(result.valid, false);
  const [entity, account, costCenter, currency] = result.results;
  assert.deepEqual(entity.unknown.map(u => [u.value, u.count, u.rows]), [["DE01", 1, [6]]]);
  assert.equal(account.valid, true);
  assert.deepEqual([costCenter.missing, costCenter.missingRows], [2, [4, 5]]);
  assert.deepEqual(costCenter.unknown.map(u => [u.value, u.suggestion]), [["CC300", "CC310"]]);
  assert.deepEqual([currency.format, currency.invalidFormat.map(v => v.value)], ["iso-currency", ["XYZ"]]);
  assert.deepEqual(codes(result.issues).filter(c => c.startsWith("error")), ["error:INVALID_FORMAT", "error:MISSING_DIMENSION", "error:UNKNOWN_VALUES", "error:UNKNOWN_VALUES"]);
  const inferred = validateFinancialDimensions({ dataset: { content: EPM } });
  assert.equal(inferred.inferred, true);
  assert.deepEqual(inferred.rules.map(r => [r.column, r.dimension, r.format]), [
    ["entity", "entity", "any"], ["account", "account", "any"], ["period", "period", "period"], ["scenario", "scenario", "any"], ["currency", "currency", "iso-currency"]
  ]);
});

test("prepares an EPM mapping from a GL export (debit − credit, period from dates, default scenario)", () => {
  const mapping = prepareFinanceMapping({ dataset: { content: GL }, target: "epm-fact", previewRows: 2, includeData: true });
  const byTarget = Object.fromEntries(mapping.mappings.map(m => [m.target, m]));
  assert.deepEqual([byTarget.Value.source, byTarget.Value.subtract], ["Débit", "Crédit"]);
  assert.deepEqual([byTarget.Period.source, byTarget.Period.transforms], ["Date comptable", ["period-month"]]);
  assert.deepEqual([byTarget.Scenario.constant, byTarget.Scenario.origin], ["Actual", "default"]);
  assert.equal(byTarget.Entity.source, "Société");
  assert.equal(byTarget.Version.origin, "none");
  assert.deepEqual(mapping.preview.rows, [
    ["FR01", "411000", "2026-01", "Actual", null, "EUR", "CC100", "1200.00"],
    ["FR01", "706000", "2026-01", "Actual", null, "EUR", "CC100", "-1000.00"]
  ]);
  assert.deepEqual(mapping.unusedColumns, ["N° pièce", "Libellé"]);
  assert.equal(mapping.complete, false);
  assert.deepEqual(mapping.issues.filter(i => i.code === "TRANSFORM_ERRORS").map(i => i.rows), [[6], [6]]);
  assert.match(mapping.exports.mappingCsv, /^target,required,source,subtract,constant,transforms,confidence,origin\nEntity,true,Société,,,trim,high,suggested\n/);
  assert.equal(JSON.parse(mapping.exports.mappingJson).target, "epm-fact");
  assert.equal(mapping.exports.dataCsv!.split("\n")[4], "fr01,512000,2026-03,Actual,,EUR,,1200.00");
});

test("applies user mappings and checks values allowed by a custom target", () => {
  const mapping = prepareFinanceMapping({
    dataset: { content: EPM },
    target: { id: "budget", name: "Budget load", description: "", fields: [
      { name: "Company", type: "text", required: true, allowedValues: ["FR01", "DE01"] },
      { name: "Month", type: "period", required: true },
      { name: "Amount", type: "number", required: true },
      { name: "Kind", type: "text", required: true }
    ] },
    mappings: [{ target: "Company", source: "entity" }, { target: "Amount", source: "amount", transforms: ["number", "negate"] }, { target: "Kind", constant: "Budget" }]
  });
  const byTarget = Object.fromEntries(mapping.mappings.map(m => [m.target, m]));
  assert.deepEqual([byTarget.Company.origin, byTarget.Month.source, byTarget.Kind.constant], ["user", "period", "Budget"]);
  assert.deepEqual(mapping.preview.rows[0], ["FR01", "2026-01", "-100.50", "Budget"]);
  assert.deepEqual(mapping.valueChecks, [{ target: "Company", unknown: [{ value: "US01", count: 1 }] }]);
  assert.equal(mapping.complete, true);
  assert.throws(() => prepareFinanceMapping({ dataset: { content: EPM }, target: "epm-fact", mappings: [{ target: "Value", source: "amount", transforms: ["eval" as never] }] }), /Unknown transform/);
});
