import type { DecimalSeparator } from "./types.js";

// ── Amounts ────────────────────────────────────────────────────────────────────
// Amounts are kept as BigInt scaled by 10^6 so totals and debit/credit balances are exact.
export const SCALE = 6;
const FACTOR = 10n ** BigInt(SCALE);
export type ParsedAmount = { value: bigint; decimals: number };

const CURRENCY_AFFIX = /^(?:[€$£¥]|[A-Z]{3}(?=[\s\d(+-]))\s*|\s*(?:[€$£¥]|[A-Z]{3})$/g;
/**
 * Parses "1 250,00", "1.250,00", "1,250.00", "(1 250.00)", "1250-" (SAP trailing minus), "-12.5 EUR", "1'250.00".
 * Returns null for empty cells and undefined for values that are not amounts.
 */
export function parseAmount(raw: string, decimal: DecimalSeparator): ParsedAmount | null | undefined {
  let s = raw.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1).trim(); }
  s = s.replace(CURRENCY_AFFIX, "").trim();
  if (s.endsWith("-")) { negative = !negative; s = s.slice(0, -1).trim(); }
  if (s.startsWith("-")) { negative = !negative; s = s.slice(1).trim(); }
  else if (s.startsWith("+")) s = s.slice(1).trim();
  if (/^\d+(?:\.\d+)?e[-+]?\d+$/i.test(s)) s = Number(s).toFixed(SCALE);
  s = s.replace(/[\s  ']/g, "");
  const thousands = decimal === "," ? "\\." : ",", dec = decimal === "," ? "," : "\\.";
  if (!new RegExp(`^(?:\\d{1,3}(?:${thousands}\\d{3})+|\\d+)?(?:${dec}\\d+)?$`).test(s) || !/\d/.test(s)) return undefined;
  const [integer = "", fraction = ""] = s.replace(new RegExp(thousands, "g"), "").split(decimal);
  const digits = fraction.slice(0, SCALE).padEnd(SCALE, "0");
  let value = BigInt(integer || "0") * FACTOR + BigInt(digits || "0");
  if (fraction.length > SCALE && Number(fraction[SCALE]) >= 5) value += 1n;
  return { value: negative ? -value : value, decimals: Math.min(fraction.length, SCALE) };
}

export function formatAmount(value: bigint, decimals = 2): string {
  const negative = value < 0n, abs = negative ? -value : value;
  const integer = abs / FACTOR, fraction = (abs % FACTOR).toString().padStart(SCALE, "0").slice(0, decimals);
  return (negative && abs > 0n ? "-" : "") + integer.toString() + (decimals ? "." + fraction : "");
}

/** Votes on the decimal separator from number-looking values ("12,50" vs "12.50", "1.250,00" vs "1,250.00"). */
export function detectDecimalSeparator(values: string[], delimiter?: string): DecimalSeparator {
  let comma = 0, dot = 0;
  for (const raw of values) {
    const s = raw.trim().replace(/[\s  ]/g, "");
    if (/^[-+(]?\d{1,3}(?:\.\d{3})+,\d+\)?-?$/.test(s) || /^[-+(]?\d+,\d{1,2}\)?-?$/.test(s)) comma++;
    else if (/^[-+(]?\d{1,3}(?:,\d{3})+\.\d+\)?-?$/.test(s) || /^[-+(]?\d+\.\d{1,2}\)?-?$/.test(s)) dot++;
  }
  if (comma !== dot) return comma > dot ? "," : ".";
  return delimiter === ";" ? "," : ".";
}

// ── Dates ──────────────────────────────────────────────────────────────────────
export type DateOrder = "dmy" | "mdy";
const pad = (n: number) => String(n).padStart(2, "0");
function validDate(year: number, month: number, day: number): string | undefined {
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1) return undefined;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= last ? `${year}-${pad(month)}-${pad(day)}` : undefined;
}
const year4 = (y: string) => y.length === 2 ? 2000 + Number(y) : Number(y);

/** Describes the shape of a date value so a whole column can decide between day/month and month/day. */
export function dateShape(raw: string): { format: string; a?: number; b?: number; year?: number } | undefined {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(s)) return { format: "yyyy-mm-dd" };
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(s)) return { format: "yyyy/mm/dd" };
  if (/^\d{8}$/.test(s)) return { format: "yyyymmdd" };
  const match = /^(\d{1,2})([/.-])(\d{1,2})\2(\d{4}|\d{2})(?: \d{2}:\d{2}(?::\d{2})?)?$/.exec(s);
  if (match) return { format: `xx${match[2]}xx${match[2]}${match[4].length === 4 ? "yyyy" : "yy"}`, a: Number(match[1]), b: Number(match[3]), year: year4(match[4]) };
  return undefined;
}

/** Column-level decision: any first part > 12 → day/month; any second part > 12 → month/day; otherwise ambiguous (European default). */
export function detectDateOrder(values: string[]): { order: DateOrder; ambiguous: boolean } {
  let dmy = false, mdy = false, slashed = false;
  for (const value of values) {
    const shape = dateShape(value);
    if (shape?.a === undefined) continue;
    slashed = true;
    if (shape.a > 12) dmy = true;
    if (shape.b! > 12) mdy = true;
  }
  if (dmy !== mdy) return { order: dmy ? "dmy" : "mdy", ambiguous: false };
  return { order: "dmy", ambiguous: slashed && !dmy && !mdy };
}

export function parseDate(raw: string, order: DateOrder = "dmy"): { iso: string; format: string } | undefined {
  const s = raw.trim(), shape = dateShape(s);
  if (!shape) return undefined;
  let iso: string | undefined;
  if (shape.format === "yyyy-mm-dd" || shape.format === "yyyy/mm/dd") iso = validDate(Number(s.slice(0, 4)), Number(s.slice(5, 7)), Number(s.slice(8, 10)));
  else if (shape.format === "yyyymmdd") iso = validDate(Number(s.slice(0, 4)), Number(s.slice(4, 6)), Number(s.slice(6, 8)));
  else {
    const [day, month] = order === "dmy" ? [shape.a!, shape.b!] : [shape.b!, shape.a!];
    iso = validDate(shape.year!, month, day);
  }
  const format = shape.a === undefined ? shape.format : shape.format.replace("xx", order === "dmy" ? "dd" : "mm").replace("xx", order === "dmy" ? "mm" : "dd");
  return iso ? { iso, format } : undefined;
}

// ── Periods ────────────────────────────────────────────────────────────────────
export type Period = { key: string; granularity: "month" | "quarter" | "year" };
const MONTHS: Record<string, number> = {
  jan: 1, janv: 1, january: 1, janvier: 1, feb: 2, fev: 2, fevr: 2, february: 2, fevrier: 2, mar: 3, mars: 3, march: 3,
  apr: 4, avr: 4, april: 4, avril: 4, may: 5, mai: 5, jun: 6, juin: 6, june: 6, jul: 7, juil: 7, july: 7, juillet: 7,
  aug: 8, aou: 8, august: 8, aout: 8, sep: 9, sept: 9, september: 9, septembre: 9, oct: 10, october: 10, octobre: 10,
  nov: 11, november: 11, novembre: 11, dec: 12, december: 12, decembre: 12
};
const month = (year: number, m: number): Period | undefined => year >= 1900 && year <= 2200 && m >= 1 && m <= 12 ? { key: `${year}-${pad(m)}`, granularity: "month" } : undefined;
const quarter = (year: number, q: number): Period | undefined => year >= 1900 && year <= 2200 ? { key: `${year}-Q${q}`, granularity: "quarter" } : undefined;

/** Parses YYYY-MM, YYYYMM, MM/YYYY, 2026-P03, P03 2026, 2026Q1, Q1 2026, T1 2026, Jan 2026, janv. 2026, FY2026 and (when allowed) 2026. */
export function parsePeriod(raw: string, allowBareYear = false): Period | undefined {
  const s = raw.trim().normalize("NFKD").replace(/[̀-ͯ]/g, "");
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})[-/.]?(\d{2})$/.exec(s))) return month(+m[1], +m[2]);
  if ((m = /^(\d{1,2})[-/.](\d{4})$/.exec(s))) return month(+m[2], +m[1]);
  if ((m = /^(\d{4})[-\s/.]?P(\d{1,2})$/i.exec(s)) || (m = /^P(\d{1,2})[-\s/.]?(\d{4})$/i.exec(s))) {
    const [year, p] = m[1].length === 4 ? [+m[1], +m[2]] : [+m[2], +m[1]];
    return month(year, p);
  }
  if ((m = /^(\d{4})[-\s/.]?[QT]([1-4])$/i.exec(s))) return quarter(+m[1], +m[2]);
  if ((m = /^[QT]([1-4])[-\s/.]?(\d{4})$/i.exec(s))) return quarter(+m[2], +m[1]);
  if ((m = /^([A-Za-z]+)\.?[-\s/]?(\d{4}|\d{2})$/.exec(s)) && MONTHS[m[1].toLowerCase()]) return month(year4(m[2]), MONTHS[m[1].toLowerCase()]);
  if ((m = /^(\d{4})[-\s/]([A-Za-z]+)\.?$/.exec(s)) && MONTHS[m[2].toLowerCase()]) return month(+m[1], MONTHS[m[2].toLowerCase()]);
  if ((m = /^(?:FY|EX)\s?(\d{4})$/i.exec(s)) || (allowBareYear && (m = /^(\d{4})$/.exec(s)))) {
    const year = +m[1];
    return year >= 1900 && year <= 2200 ? { key: String(year), granularity: "year" } : undefined;
  }
  return undefined;
}

export function periodFromDate(iso: string, granularity: Period["granularity"]): string {
  const year = iso.slice(0, 4), m = Number(iso.slice(5, 7));
  return granularity === "month" ? iso.slice(0, 7) : granularity === "quarter" ? `${year}-Q${Math.ceil(m / 3)}` : year;
}

/** Missing periods between the first and last one (bounded). */
export function periodGaps(keys: string[], granularity: Period["granularity"], limit = 24): string[] {
  if (!keys.length) return [];
  const index = (key: string) => granularity === "year" ? +key : granularity === "quarter" ? +key.slice(0, 4) * 4 + +key.slice(6) - 1 : +key.slice(0, 4) * 12 + +key.slice(5, 7) - 1;
  const label = (i: number) => granularity === "year" ? String(i) : granularity === "quarter" ? `${Math.floor(i / 4)}-Q${i % 4 + 1}` : `${Math.floor(i / 12)}-${pad(i % 12 + 1)}`;
  const present = new Set(keys.map(index)), sorted = [...present].sort((a, b) => a - b);
  const gaps: string[] = [];
  for (let i = sorted[0]; i <= sorted[sorted.length - 1] && gaps.length < limit; i++) if (!present.has(i)) gaps.push(label(i));
  return gaps;
}

// ── Currencies (ISO 4217) ──────────────────────────────────────────────────────
const ACTIVE = "AED AFN ALL AMD AOA ARS AUD AWG AZN BAM BBD BDT BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CLP CNY COP CRC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYU UZS VES VND VUV WST XAF XCD XCG XOF XPF YER ZAR ZMW ZWG";
const WITHDRAWN = "ANG BGN CUC EEK HRK LTL LVL MRO SLL STD VEF ZWL";
export const ACTIVE_CURRENCIES = new Set(ACTIVE.split(" "));
export const WITHDRAWN_CURRENCIES = new Set(WITHDRAWN.split(" "));
export type CurrencyCheck = "active" | "withdrawn" | "unknown" | "invalid";
export function checkCurrency(raw: string): CurrencyCheck {
  const code = raw.trim();
  if (!/^[A-Za-z]{3}$/.test(code)) return "invalid";
  const upper = code.toUpperCase();
  return ACTIVE_CURRENCIES.has(upper) ? "active" : WITHDRAWN_CURRENCIES.has(upper) ? "withdrawn" : "unknown";
}

// ── Text helpers ───────────────────────────────────────────────────────────────
export const normalizeKey = (text: string) => text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Bounded Levenshtein distance, used to suggest the closest reference value. */
export function editDistance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, current[j]);
    }
    if (best > max) return max + 1;
    previous = current;
  }
  return previous[b.length];
}

const commonPrefix = (a: string, b: string) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return i; };
/** Nearest candidate by edit distance; ties go to the longest common prefix (codes are usually hierarchical). */
export function closest(value: string, candidates: string[]): string | undefined {
  const key = value.trim().toLowerCase();
  const exact = candidates.find(c => c.trim().toLowerCase() === key);
  if (exact) return exact;
  const limit = Math.min(3, Math.max(1, Math.floor(key.length / 3)));
  let best: { candidate: string; distance: number; prefix: number } | undefined;
  for (const candidate of candidates) {
    const lower = candidate.trim().toLowerCase(), distance = editDistance(key, lower, limit);
    if (distance > limit) continue;
    const prefix = commonPrefix(key, lower);
    if (!best || distance < best.distance || (distance === best.distance && prefix > best.prefix)) best = { candidate, distance, prefix };
  }
  return best?.candidate;
}
