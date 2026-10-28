import test from "node:test";
import assert from "node:assert/strict";
import { analyzeCsv } from "./csv.js";
import { compareJsonSchemas } from "./compare.js";
test("CSV handles quoted separators and missing cells", () => {
  const result = analyzeCsv('name,amount\n"ACME, Inc",12\nOther,\n');
  assert.equal(result.rowCount, 2);
  assert.equal(result.columns[1].inferredType, "number");
  assert.equal(result.columns[1].missing, 1);
});
test("CSV rejects inconsistent rows", () => assert.throws(() => analyzeCsv("a,b\n1"), /Inconsistent/));
test("schema comparison detects changes", () => {
  const diff = compareJsonSchemas({ a: 1, b: true }, { a: "1", c: 2 });
  assert.deepEqual(diff.map(d => [d.path, d.change]), [["a","type_changed"],["b","removed"],["c","added"]]);
});
