import test from "node:test";
import assert from "node:assert/strict";
import { analyzeDataStructure } from "./index.js";
test("analyzes nested JSON structure", () => {
  const result = analyzeDataStructure({ invoice: { amount: 125, currency: "EUR" } });
  assert.equal(result.rootType, "object");
  assert.ok(result.fields.some(field => field.path === "invoice.amount" && field.type === "number"));
});
test("rejects overly deep nesting", () => {
  let value: unknown = null;
  for (let i = 0; i < 22; i++) value = { nested: value };
  assert.throws(() => analyzeDataStructure(value), /Maximum nesting depth/);
});
