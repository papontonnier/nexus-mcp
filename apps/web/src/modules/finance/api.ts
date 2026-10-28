import type {
  DatasetAnalysis, DatasetInput, DimensionRule, DimensionValidation, FieldMapping, FinanceMapping, TargetModel
} from "@nexus/finance-solutions/types";
import { request } from "../../services/http";

const post = <T>(url: string, body: unknown) => request<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const financeApi = {
  templates: () => request<TargetModel[]>("/api/finance/templates"),
  analyze: (dataset: DatasetInput) => post<DatasetAnalysis>("/api/finance/analyze", dataset),
  dimensions: (dataset: DatasetInput, rules: DimensionRule[]) => post<DimensionValidation>("/api/finance/dimensions", { dataset, rules }),
  mapping: (dataset: DatasetInput, target: string, mappings: FieldMapping[], includeData = false) =>
    post<FinanceMapping>("/api/finance/mapping", { dataset, target, mappings, previewRows: 10, includeData })
};

/** Reads a local file as text; legacy ERP exports in Windows-1252 are re-decoded when UTF-8 fails. */
export async function readTextFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
  catch { return new TextDecoder("windows-1252").decode(buffer); }
}

export function download(name: string, content: string, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([content], { type: type + ";charset=utf-8" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: name });
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
