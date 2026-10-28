import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { financeRoutes } from "./finance.js";

const CSV = "Entity;Account;Period;Amount;Currency\nFR01;606100;2026-01;1 250,50;EUR\nFR01;606100;2026-03;-250,00;EUR\nDE01;706000;2026-01;abc;EUR\n";
async function server(t: TestContext) {
  const app = Fastify();
  await app.register(financeRoutes, { prefix: "/api/finance" });
  t.after(() => app.close());
  return app;
}
const post = (app: Awaited<ReturnType<typeof server>>, url: string, payload: unknown) => app.inject({ method: "POST", url, payload: payload as object });

test("lists the generic mapping templates", async t => {
  const app = await server(t);
  const response = await app.inject("/api/finance/templates");
  assert.deepEqual(response.json().map((t: { id: string }) => t.id), ["epm-fact", "general-ledger", "cash-transactions"]);
});

test("analyzes, validates and maps a dataset", async t => {
  const app = await server(t);
  const analysis = (await post(app, "/api/finance/analyze", { content: CSV })).json();
  assert.deepEqual([analysis.delimiter, analysis.decimalSeparator, analysis.rowCount], [";", ",", 3]);
  assert.ok(analysis.issues.some((i: { code: string }) => i.code === "PERIOD_GAPS"));
  const dimensions = (await post(app, "/api/finance/dimensions", { dataset: { content: CSV }, rules: [{ column: "Entity", allowedValues: ["FR01"] }] })).json();
  assert.deepEqual(dimensions.results[0].unknown.map((u: { value: string }) => u.value), ["DE01"]);
  const mapping = (await post(app, "/api/finance/mapping", { dataset: { content: CSV }, target: "epm-fact", previewRows: 1 })).json();
  assert.deepEqual(mapping.preview.rows, [["FR01", "606100", "2026-01", "Actual", null, "EUR", null, "1250.50"]]);
});

test("returns 400 with a code for invalid requests", async t => {
  const app = await server(t);
  const cases: [string, unknown, string][] = [
    ["/api/finance/analyze", { content: "" }, "INVALID_INPUT"],
    ["/api/finance/analyze", { content: "a,b\n1" }, "INVALID_DATASET"],
    ["/api/finance/dimensions", { dataset: { content: CSV }, rules: [{ column: "Missing" }] }, "UNKNOWN_COLUMN"],
    ["/api/finance/mapping", { dataset: { content: CSV }, target: "jedox" }, "UNKNOWN_TARGET"],
    ["/api/finance/mapping", { dataset: { content: CSV } }, "INVALID_INPUT"]
  ];
  for (const [url, payload, code] of cases) {
    const response = await post(app, url, payload);
    assert.equal(response.statusCode, 400, `${url} ${JSON.stringify(payload).slice(0, 60)}`);
    assert.equal(response.json().code, code, url);
  }
  // Unknown properties are stripped: the API never reads files, whatever the payload claims.
  const stripped = await post(app, "/api/finance/analyze", { content: "a\n1", path: "/etc/passwd" });
  assert.deepEqual([stripped.statusCode, stripped.json().rowCount, stripped.json().columns[0].name], [200, 1, "a"]);
});
