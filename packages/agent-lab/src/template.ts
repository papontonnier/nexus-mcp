import type { Condition } from "./types.js";

// References are plain property paths — never evaluated code. Prototype keys are refused.
const REFERENCE = /\{\{\s*([^{}]+?)\s*\}\}/g;
const WHOLE = /^\{\{\s*([^{}]+?)\s*\}\}$/;
const FORBIDDEN = new Set(["__proto__", "prototype", "constructor"]);
export type Scope = { inputs: Record<string, unknown>; steps: Record<string, { output?: unknown; status: string }> };

export function parsePath(path: string): string[] {
  const segments = path.trim().replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  if (!segments.length || segments.some(s => FORBIDDEN.has(s) || !/^[\w-]+$/.test(s))) throw new Error(`Invalid reference "${path}"`);
  return segments;
}

export function lookup(scope: Scope, path: string): unknown {
  let current: unknown = scope;
  for (const segment of parsePath(path)) {
    if (current === null || typeof current !== "object" || !Object.hasOwn(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** Every reference used by a value, e.g. ["inputs.csv", "steps.analyze.output.columns"]. */
export function references(value: unknown): string[] {
  if (typeof value === "string") return [...value.matchAll(REFERENCE)].map(m => m[1].trim());
  if (Array.isArray(value)) return value.flatMap(references);
  if (value && typeof value === "object") return Object.values(value).flatMap(references);
  return [];
}

const primitive = (v: unknown) => v === null || ["string", "number", "boolean"].includes(typeof v);
/** Text rendering of a referenced value: lists of plain values read as "a, b, c"; structures as indented JSON. */
const display = (value: unknown) => value === undefined || value === null ? ""
  : typeof value === "string" ? value
  : Array.isArray(value) && value.every(primitive) ? (value.length ? value.join(", ") : "none")
  : JSON.stringify(value, null, 2);

export function resolve(value: unknown, scope: Scope): unknown {
  if (typeof value === "string") {
    const whole = WHOLE.exec(value);
    if (whole) return lookup(scope, whole[1]);
    return value.replace(REFERENCE, (_, path: string) => display(lookup(scope, path)));
  }
  if (Array.isArray(value)) return value.map(item => resolve(item, scope));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v, scope)]));
  return value;
}

export function evaluate(condition: Condition, scope: Scope): boolean {
  const actual = lookup(scope, condition.ref), expected = condition.value;
  const number = (v: unknown) => typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  switch (condition.op) {
    case "exists": return actual !== undefined && actual !== null;
    case "truthy": return Array.isArray(actual) ? actual.length > 0 : !!actual;
    case "falsy": return Array.isArray(actual) ? actual.length === 0 : !actual;
    case "eq": return actual === expected || String(actual) === String(expected);
    case "ne": return !(actual === expected || String(actual) === String(expected));
    case "gt": return number(actual) > number(expected);
    case "gte": return number(actual) >= number(expected);
    case "lt": return number(actual) < number(expected);
    case "lte": return number(actual) <= number(expected);
  }
}
