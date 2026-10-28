import test from "node:test";
import assert from "node:assert/strict";
import { checkCurrency, closest, detectDateOrder, detectDecimalSeparator, formatAmount, parseAmount, parseDate, parsePeriod, periodGaps } from "./values.js";

const amount = (raw: string, decimal: "." | "," = ".") => { const parsed = parseAmount(raw, decimal); return parsed ? formatAmount(parsed.value, Math.max(2, parsed.decimals)) : parsed; };

test("parses French, English, accounting and ERP amount notations exactly", () => {
  assert.equal(amount("1 250,50", ","), "1250.50");
  assert.equal(amount("1.250,50", ","), "1250.50");
  assert.equal(amount("1 250,5", ","), "1250.50");
  assert.equal(amount("1,250.50"), "1250.50");
  assert.equal(amount("(1 250.00)"), "-1250.00");
  assert.equal(amount("1250-"), "-1250.00");
  assert.equal(amount("-12.5 EUR"), "-12.50");
  assert.equal(amount("€ 99"), "99.00");
  assert.equal(amount("1'250.75"), "1250.75");
  assert.equal(amount("0.1234567"), "0.123457");
  assert.equal(amount(""), null);
  assert.equal(amount("12,5,0", ","), undefined);
  assert.equal(amount("abc"), undefined);
  assert.equal(amount("1,25", "."), undefined);
  // Exact sums: 0.1 + 0.2 must be 0.3, not 0.30000000000000004.
  assert.equal(formatAmount(parseAmount("0.1", ".")!.value + parseAmount("0.2", ".")!.value), "0.30");
});

test("votes on the decimal separator", () => {
  assert.equal(detectDecimalSeparator(["12,50", "1.250,00", "3"]), ",");
  assert.equal(detectDecimalSeparator(["12.50", "1,250.00"]), ".");
  assert.equal(detectDecimalSeparator(["12", "15"], ";"), ",");
  assert.equal(detectDecimalSeparator(["12", "15"], ","), ".");
});

test("dates: ISO, compact, European and US orders, invalid calendar days", () => {
  assert.deepEqual(parseDate("2026-01-31"), { iso: "2026-01-31", format: "yyyy-mm-dd" });
  assert.deepEqual(parseDate("20260131"), { iso: "2026-01-31", format: "yyyymmdd" });
  assert.deepEqual(parseDate("31/01/2026"), { iso: "2026-01-31", format: "dd/mm/yyyy" });
  assert.deepEqual(parseDate("31.01.26"), { iso: "2026-01-31", format: "dd.mm.yy" });
  assert.deepEqual(parseDate("01/31/2026", "mdy"), { iso: "2026-01-31", format: "mm/dd/yyyy" });
  assert.equal(parseDate("31/02/2026"), undefined);
  assert.equal(parseDate("2026-13-01"), undefined);
  assert.deepEqual(detectDateOrder(["13/01/2026", "02/03/2026"]), { order: "dmy", ambiguous: false });
  assert.deepEqual(detectDateOrder(["01/13/2026"]), { order: "mdy", ambiguous: false });
  assert.deepEqual(detectDateOrder(["01/02/2026"]), { order: "dmy", ambiguous: true });
});

test("periods: months, fiscal periods, quarters, French labels and gaps", () => {
  const key = (raw: string, bare = false) => parsePeriod(raw, bare)?.key;
  assert.equal(key("2026-01"), "2026-01");
  assert.equal(key("202601"), "2026-01");
  assert.equal(key("01/2026"), "2026-01");
  assert.equal(key("2026-P03"), "2026-03");
  assert.equal(key("P03 2026"), "2026-03");
  assert.equal(key("2026Q2"), "2026-Q2");
  assert.equal(key("T3 2026"), "2026-Q3");
  assert.equal(key("janv. 2026"), "2026-01");
  assert.equal(key("Févr 2026"), "2026-02");
  assert.equal(key("Dec-26"), "2026-12");
  assert.equal(key("FY2026"), "2026");
  assert.equal(key("2026"), undefined);
  assert.equal(key("2026", true), "2026");
  assert.equal(key("2026-13"), undefined);
  assert.deepEqual(periodGaps(["2025-11", "2026-02", "2026-03"], "month"), ["2025-12", "2026-01"]);
  assert.deepEqual(periodGaps(["2026-Q1", "2026-Q4"], "quarter"), ["2026-Q2", "2026-Q3"]);
});

test("currencies and closest reference values", () => {
  assert.equal(checkCurrency("EUR"), "active");
  assert.equal(checkCurrency("eur"), "active");
  assert.equal(checkCurrency("HRK"), "withdrawn");
  assert.equal(checkCurrency("XYZ"), "unknown");
  assert.equal(checkCurrency("EURO"), "invalid");
  assert.equal(closest("fr-01", ["FR01", "DE01"]), "FR01");
  assert.equal(closest("de01", ["FR01", "DE01"]), "DE01");
  assert.equal(closest("ZZ99", ["FR01", "DE01"]), undefined);
});
