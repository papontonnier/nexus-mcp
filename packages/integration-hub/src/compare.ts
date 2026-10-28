import { analyzeDataStructure } from "./index.js";
export type SchemaDifference = { path: string; change: "added" | "removed" | "type_changed"; sourceType?: string; targetType?: string };
export function compareJsonSchemas(source: unknown, target: unknown): SchemaDifference[] {
  const a = new Map(analyzeDataStructure(source).fields.map(f => [f.path, f.type]));
  const b = new Map(analyzeDataStructure(target).fields.map(f => [f.path, f.type]));
  const paths = [...new Set([...a.keys(), ...b.keys()])].sort();
  return paths.flatMap(path => {
    const sourceType = a.get(path), targetType = b.get(path);
    if (sourceType === targetType) return [];
    return [{ path, change: sourceType === undefined ? "added" : targetType === undefined ? "removed" : "type_changed", sourceType, targetType } as SchemaDifference];
  });
}
