import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerFinanceTools } from "./finance.js";

const CSV = "Date,Bank account,Counterparty,Amount,Currency\n2026-01-05,FR76-001,ACME,1250.50,EUR\n2026-01-09,FR76-001,Supplier SA,-300,EUR\n";
async function connect(t: TestContext) {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerFinanceTools(server);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  t.after(async () => { await client.close(); await server.close(); });
  return client;
}
const call = async (client: Client, name: string, args: Record<string, unknown>) => {
  const result = await client.callTool({ name, arguments: args }) as { isError?: boolean; content: { text: string }[] };
  return { isError: !!result.isError, text: result.content[0].text };
};

test("registers three read-only finance tools", async t => {
  const client = await connect(t);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name), ["analyze_financial_dataset", "validate_financial_dimensions", "prepare_finance_mapping"]);
  for (const tool of tools) assert.equal(tool.annotations?.readOnlyHint, true, tool.name);
});

test("finance tools analyze, validate and map through MCP", async t => {
  const client = await connect(t);
  const analysis = JSON.parse((await call(client, "analyze_financial_dataset", { content: CSV })).text);
  assert.deepEqual(analysis.totals, [{ column: "Amount", currency: "EUR", total: "950.50", rows: 2 }]);
  const dimensions = JSON.parse((await call(client, "validate_financial_dimensions", { content: CSV, rules: [{ column: "Currency", dimension: "currency" }] })).text);
  assert.equal(dimensions.valid, true);
  const mapping = JSON.parse((await call(client, "prepare_finance_mapping", { content: CSV, target: "cash-transactions" })).text);
  const sources = Object.fromEntries(mapping.mappings.map((m: { target: string; source?: string }) => [m.target, m.source]));
  assert.deepEqual([sources.Date, sources.BankAccount, sources.Counterparty, sources.Amount], ["Date", "Bank account", "Counterparty", "Amount"]);
  assert.equal(mapping.complete, true);
});

test("finance tools report invalid input as errors", async t => {
  const client = await connect(t);
  const result = await call(client, "prepare_finance_mapping", { content: CSV, target: "epm-fact", mappings: [{ target: "Value", source: "Nope" }] });
  assert.deepEqual([result.isError, result.text], [true, 'UNKNOWN_COLUMN: Column "Nope" does not exist']);
});
