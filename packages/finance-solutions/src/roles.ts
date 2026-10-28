import type { ColumnRole, Confidence, DecimalSeparator, ValueType } from "./types.js";
import { checkCurrency, dateShape, normalizeKey, parseAmount, parsePeriod } from "./values.js";

// Column-name vocabulary (English, French and common ERP field names). Longer phrases win over single words.
const VOCABULARY: [ColumnRole, string[]][] = [
  ["debit", ["debit", "debits", "dr", "debit amount", "montant debit", "mouvement debit"]],
  ["credit", ["credit", "credits", "cr", "credit amount", "montant credit", "mouvement credit"]],
  ["amount", ["amount", "amt", "montant", "value", "valeur", "solde", "balance", "total", "net", "gross", "brut", "ht", "ttc", "mnt", "sum", "somme", "revenue", "chiffre d affaires", "ca", "local amount", "amount lc", "amount dc", "wrbtr", "dmbtr"]],
  ["date", ["date", "dt", "posting date", "date comptable", "date ecriture", "value date", "date valeur", "transaction date", "booking date", "document date", "date piece", "budat", "bldat", "jour"]],
  ["period", ["period", "periode", "month", "mois", "fiscal period", "per", "fy", "year month", "quarter", "trimestre", "year", "annee", "exercice", "fiscal year", "time", "temps", "monat", "poper"]],
  ["currency", ["currency", "devise", "ccy", "cur", "curr", "monnaie", "currency code", "code devise", "waers"]],
  ["entity", ["entity", "entite", "company", "societe", "legal entity", "company code", "code societe", "bukrs", "filiale", "subsidiary", "business unit", "bu", "organisation", "organization"]],
  ["account", ["account", "compte", "gl", "gl account", "account number", "numero de compte", "compte general", "compte comptable", "hkont", "saknr", "nature comptable"]],
  ["costCenter", ["cost center", "cost centre", "centre de cout", "centre de couts", "cc", "cdc", "kostl", "centre analytique", "section analytique", "analytic", "analytique", "profit center", "centre de profit", "prctr", "department", "departement", "dept"]],
  ["scenario", ["scenario", "data type", "category type"]],
  ["version", ["version", "ver", "iteration"]],
  ["counterparty", ["counterparty", "contrepartie", "tiers", "customer", "client", "supplier", "fournisseur", "vendor", "partner", "partenaire", "third party", "intercompany partner"]],
  ["category", ["category", "categorie", "flux", "flow", "cash category", "rubrique", "type de flux", "nature de flux", "cash flow category"]],
  ["description", ["description", "libelle", "label", "memo", "comment", "commentaire", "narration", "wording", "text", "texte", "designation", "sgtxt"]],
  ["identifier", ["id", "identifier", "reference", "ref", "invoice number", "numero facture", "piece", "numero de piece", "document number", "journal entry", "ecriture", "num", "no", "transaction id", "belnr"]],
  ["dimension", ["bank account", "compte bancaire", "iban", "rib", "project", "projet", "region", "segment", "product", "produit", "channel", "canal"]]
];
const SCENARIO_VALUES = new Set(["actual", "actuals", "act", "real", "reel", "realise", "budget", "bud", "bdg", "forecast", "fcst", "fc", "prevision", "plan", "outlook", "rolling forecast"]);

export function nameMatch(name: string): { role: ColumnRole; score: number } | undefined {
  const key = normalizeKey(name.replace(/([a-z])([A-Z])/g, "$1 $2"));
  const tokens = ` ${key} `;
  let best: { role: ColumnRole; score: number } | undefined;
  for (const [role, words] of VOCABULARY) {
    for (const word of words) {
      const score = key === word ? word.split(" ").length * 2 + 1 : tokens.includes(` ${word} `) ? word.split(" ").length * 2 : 0;
      if (score && (!best || score > best.score)) best = { role, score };
    }
  }
  return best;
}

export type RoleDetection = { role: ColumnRole; confidence: Confidence; reason: string; valueType: ValueType };
const share = (count: number, total: number) => total ? count / total : 0;

/** Combines what the column is called with what its values look like. */
export function detectRole(name: string, values: string[], decimal: DecimalSeparator, rowCount: number): RoleDetection {
  const filled = values.map(v => v.trim()).filter(Boolean);
  if (!filled.length) return { role: nameMatch(name)?.role ?? "other", confidence: "low", reason: "column is empty", valueType: "empty" };
  const sample = filled.slice(0, 5000);
  const amounts = sample.filter(v => parseAmount(v, decimal)).length;
  const decimals = sample.filter(v => /[.,]\d{1,6}\)?-?$/.test(v.trim())).length;
  const dates = sample.filter(v => dateShape(v) && !/^\d{8}$/.test(v)).length;
  const compactDates = sample.filter(v => /^\d{8}$/.test(v) && dateShape(v)).length;
  const structuredPeriods = sample.filter(v => /\D/.test(v) && parsePeriod(v)).length;
  const periods = sample.filter(v => parsePeriod(v, true)).length;
  const currencies = sample.filter(v => checkCurrency(v) !== "invalid" && /^[A-Z]{3}$/.test(v)).length;
  const scenarios = sample.filter(v => SCENARIO_VALUES.has(normalizeKey(v))).length;
  const distinct = new Set(sample).size;
  const n = sample.length;
  const byName = nameMatch(name);
  const valueType: ValueType = share(dates, n) >= 0.9 || (byName?.role === "date" && share(dates + compactDates, n) >= 0.9) ? "date"
    : share(structuredPeriods, n) >= 0.9 || (byName?.role === "period" && share(periods, n) >= 0.9) ? "period"
    : share(amounts, n) >= 0.9 ? "number" : "text";

  if (byName) {
    const role = byName.role;
    const agrees =
      role === "amount" || role === "debit" || role === "credit" ? valueType === "number"
      : role === "date" ? valueType === "date"
      : role === "period" ? valueType === "period"
      : role === "currency" ? share(currencies, n) >= 0.9
      : role === "scenario" ? true
      : role === "description" || role === "identifier" ? true
      : valueType !== "date";
    if (agrees) return { role, confidence: byName.score >= 3 ? "high" : "medium", reason: `name "${name}" and values match ${role}`, valueType };
    if ((role === "amount" || role === "debit" || role === "credit") && valueType !== "number") {
      return { role, confidence: "low", reason: `name suggests ${role} but values are not all numeric`, valueType };
    }
  }
  if (share(currencies, n) >= 0.9 && distinct <= 20) return { role: "currency", confidence: "medium", reason: "values are ISO currency codes", valueType: "text" };
  if (valueType === "date") return { role: "date", confidence: "medium", reason: "values are dates", valueType };
  if (valueType === "period") return { role: "period", confidence: "medium", reason: "values are periods", valueType };
  if (share(scenarios, n) >= 0.9) return { role: "scenario", confidence: "medium", reason: "values look like scenarios (Actual, Budget, Forecast…)", valueType };
  if (valueType === "number" && decimals > 0) return { role: "amount", confidence: "medium", reason: "values are decimal numbers", valueType };
  if (byName) return { role: byName.role, confidence: "low", reason: `name "${name}" suggests ${byName.role}`, valueType };
  if (distinct <= 50 && distinct <= Math.max(2, rowCount * 0.5)) return { role: "dimension", confidence: "low", reason: `${distinct} recurring values`, valueType };
  return { role: "other", confidence: "low", reason: "no financial pattern detected", valueType };
}
