export type JsonField = { path: string; type: string; nullable: boolean };
export type StructureAnalysis = { format: "json"; fields: JsonField[]; rootType: string };
function kind(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
export function analyzeDataStructure(input: unknown): StructureAnalysis {
  const fields: JsonField[] = [];
  function visit(value: unknown, path: string, depth: number): void {
    if (depth > 20) throw new Error("Maximum nesting depth exceeded");
    const type = kind(value);
    fields.push({ path: path || "$", type, nullable: value === null });
    if (type === "object") {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        visit(child, path ? path + "." + key : key, depth + 1);
      }
    } else if (Array.isArray(value) && value.length) {
      visit(value[0], (path || "$") + "[0]", depth + 1);
    }
  }
  visit(input, "", 0);
  return { format: "json", rootType: kind(input), fields };
}
