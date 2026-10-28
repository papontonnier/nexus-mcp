import { parseCsv } from "@nexus/integration-hub/csv";
import type { DatasetFormat, DatasetInput, DecimalSeparator } from "./types.js";
import { detectDecimalSeparator } from "./values.js";

export type FinanceErrorCode = "INVALID_DATASET" | "INVALID_INPUT" | "UNKNOWN_COLUMN" | "UNKNOWN_TARGET";
export class FinanceError extends Error {
  readonly code: FinanceErrorCode;
  constructor(code: FinanceErrorCode, message: string) { super(message); this.name = "FinanceError"; this.code = code; }
}

export const LIMITS = { maxContentLength: 5_000_000, maxRows: 100_000, maxColumns: 200 };
export type Table = { format: DatasetFormat; delimiter?: string; decimal: DecimalSeparator; headers: string[]; rows: string[][] };

const DELIMITERS = [",", ";", "\t", "|"];
/** Counts candidate delimiters outside quotes on the header line. */
export function detectDelimiter(content: string): string {
  const firstLine = content.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "";
  const counts = new Map(DELIMITERS.map(d => [d, 0]));
  let quoted = false;
  for (const ch of firstLine) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && counts.has(ch)) counts.set(ch, counts.get(ch)! + 1);
  }
  const [best, count] = [...counts].sort((a, b) => b[1] - a[1])[0];
  return count ? best : ",";
}

const cell = (value: unknown): string =>
  value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);

function flatten(record: Record<string, unknown>, prefix = "", depth = 0, out: Record<string, unknown> = {}) {
  for (const [key, value] of Object.entries(record)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value) && depth < 2) flatten(value as Record<string, unknown>, name, depth + 1, out);
    else out[name] = value;
  }
  return out;
}

function fromJson(content: string): { headers: string[]; rows: string[][] } {
  let data: unknown;
  try { data = JSON.parse(content); } catch (e) { throw new FinanceError("INVALID_DATASET", "Invalid JSON: " + (e as Error).message); }
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const list = Object.values(data).filter(Array.isArray);
    if (list.length === 1) data = list[0];
  }
  if (!Array.isArray(data) || data.some(item => !item || typeof item !== "object" || Array.isArray(item))) {
    throw new FinanceError("INVALID_DATASET", "JSON datasets must be an array of objects (or an object holding one such array)");
  }
  const records = data.map(item => flatten(item as Record<string, unknown>));
  const headers: string[] = [];
  for (const record of records) for (const key of Object.keys(record)) if (!headers.includes(key)) headers.push(key);
  return { headers, rows: records.map(record => headers.map(h => cell(record[h]))) };
}

export function loadDataset(input: DatasetInput): Table {
  if (!input || typeof input.content !== "string") throw new FinanceError("INVALID_INPUT", "Provide the dataset content as text");
  const content = input.content.replace(/^﻿/, "");
  if (!content.trim()) throw new FinanceError("INVALID_DATASET", "The dataset is empty");
  if (content.length > LIMITS.maxContentLength) throw new FinanceError("INVALID_DATASET", "Datasets are limited to 5 million characters");
  const format: DatasetFormat = input.format === "csv" || input.format === "json" ? input.format : /^\s*[[{]/.test(content) ? "json" : "csv";
  let delimiter: string | undefined, parsed: { headers: string[]; rows: string[][] };
  if (format === "json") parsed = fromJson(content);
  else {
    delimiter = input.delimiter || detectDelimiter(content);
    try { parsed = parseCsv(content.replace(/[\r\n\s]+$/, ""), delimiter); }
    catch (e) { throw new FinanceError("INVALID_DATASET", "Invalid CSV: " + (e as Error).message); }
  }
  const headers = parsed.headers.map(h => h.trim());
  if (!headers.length) throw new FinanceError("INVALID_DATASET", "No columns found");
  if (headers.length > LIMITS.maxColumns) throw new FinanceError("INVALID_DATASET", `Datasets are limited to ${LIMITS.maxColumns} columns`);
  if (parsed.rows.length > LIMITS.maxRows) throw new FinanceError("INVALID_DATASET", `Datasets are limited to ${LIMITS.maxRows.toLocaleString("en")} rows`);
  const decimal = input.decimalSeparator === "." || input.decimalSeparator === ","
    ? input.decimalSeparator
    : detectDecimalSeparator(parsed.rows.slice(0, 2000).flat(), delimiter);
  return { format, delimiter, decimal, headers, rows: parsed.rows };
}

export function columnIndex(table: Table, column: string): number {
  const index = table.headers.indexOf(column.trim());
  if (index < 0) throw new FinanceError("UNKNOWN_COLUMN", `Column "${column}" does not exist`);
  return index;
}
