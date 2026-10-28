// Public contracts shared by the API, the MCP server and (type-only) the web app.
// Keep this file free of runtime imports so browsers can consume it.

export type DatasetFormat = "csv" | "json";
export type DecimalSeparator = "." | ",";
/** A dataset is sent with every request: NEXUS keeps no copy of financial data. */
export type DatasetInput = { content: string; format?: DatasetFormat | "auto"; delimiter?: string; decimalSeparator?: DecimalSeparator | "auto" };

export type ColumnRole =
  | "amount" | "debit" | "credit" | "date" | "period" | "currency" | "entity" | "account" | "costCenter"
  | "scenario" | "version" | "counterparty" | "category" | "description" | "identifier" | "dimension" | "other";
export type ValueType = "number" | "date" | "period" | "text" | "empty";
export type Confidence = "high" | "medium" | "low";

export type AmountStats = { total: string; min: string; max: string; negatives: number; zeros: number; invalid: number; maxDecimals: number };
export type DateStats = { min: string; max: string; formats: string[]; invalid: number; ambiguous: boolean };
export type PeriodStats = { min: string; max: string; granularity: "month" | "quarter" | "year" | "mixed"; distinct: number; gaps: string[]; invalid: number };
export type ColumnProfile = {
  name: string; index: number; role: ColumnRole; confidence: Confidence; reason: string; valueType: ValueType;
  missing: number; distinct: number; examples: string[];
  amount?: AmountStats; dates?: DateStats; periods?: PeriodStats;
};

export type IssueSeverity = "error" | "warning" | "info";
/** Rows are 1-based data rows (the header is not counted). */
export type FinanceIssue = { severity: IssueSeverity; code: string; message: string; column?: string; count?: number; rows?: number[] };

export type CurrencyTotal = { column: string; currency: string | null; total: string; rows: number };
export type DatasetAnalysis = {
  format: DatasetFormat; delimiter?: string; decimalSeparator: DecimalSeparator; rowCount: number; columnCount: number;
  columns: ColumnProfile[]; roles: Partial<Record<ColumnRole, string[]>>;
  totals: CurrencyTotal[];
  balance?: { debit: string; credit: string; difference: string; balanced: boolean };
  duplicates: { exactRows: number; duplicateKeys: number; keyColumns: string[] };
  issues: FinanceIssue[]; summary: { errors: number; warnings: number; infos: number };
};

export type DimensionKind = "entity" | "account" | "costCenter" | "period" | "scenario" | "version" | "currency" | "custom";
export type ValueFormat = "any" | "iso-currency" | "period" | "date" | "numeric" | "alphanumeric";
export type DimensionRule = {
  column: string; dimension?: DimensionKind; label?: string; required?: boolean;
  allowedValues?: string[]; format?: ValueFormat; caseSensitive?: boolean; minLength?: number; maxLength?: number;
};
export type ValueCount = { value: string; count: number; rows: number[] };
export type DimensionResult = {
  column: string; dimension: DimensionKind; label: string; format: ValueFormat; required: boolean; hasReferenceList: boolean;
  distinct: number; missing: number; missingRows: number[];
  invalidFormat: ValueCount[]; unknown: (ValueCount & { suggestion?: string })[]; values: ValueCount[]; valid: boolean;
};
export type DimensionValidation = { rowCount: number; rules: DimensionRule[]; inferred: boolean; results: DimensionResult[]; issues: FinanceIssue[]; valid: boolean };

export type FieldType = "text" | "number" | "date" | "period";
export type TargetField = { name: string; type: FieldType; required: boolean; role?: ColumnRole; aliases?: string[]; description?: string; allowedValues?: string[]; defaultConstant?: string };
export type TargetModel = { id: string; name: string; description: string; fields: TargetField[] };
export type Transform = "trim" | "uppercase" | "lowercase" | "number" | "negate" | "absolute" | "date-iso" | "period-month" | "period-quarter" | "period-year";
export type FieldMapping = { target: string; source?: string; subtract?: string; constant?: string; transforms?: Transform[] };
export type MappingRequest = { dataset: DatasetInput; target: string | TargetModel; mappings?: FieldMapping[]; previewRows?: number; includeData?: boolean };
export type MappedField = FieldMapping & {
  transforms: Transform[]; origin: "suggested" | "user" | "default" | "none"; confidence: Confidence | "none"; reason: string;
  candidates: { source: string; score: number }[]; errors: number;
};
export type ValueMappingCheck = { target: string; unknown: { value: string; count: number; suggestion?: string }[] };
export type FinanceMapping = {
  target: TargetModel; rowCount: number; mappings: MappedField[]; unmappedRequired: string[]; unusedColumns: string[];
  valueChecks: ValueMappingCheck[]; issues: FinanceIssue[]; complete: boolean;
  preview: { columns: string[]; rows: (string | null)[][] };
  exports: { mappingCsv: string; mappingJson: string; dataCsv?: string };
};
