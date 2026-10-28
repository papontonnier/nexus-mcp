export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return "—";
  if (bytes < 1024) return bytes + " B";
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024, unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return (value < 10 ? value.toFixed(1) : Math.round(value)) + " " + units[unit];
}
export function formatDate(date: string | undefined): string {
  return date ? new Date(date).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—";
}
export const formatNumber = (value: number) => value.toLocaleString();
export const plural = (count: number, word: string, words = word + "s") => `${formatNumber(count)} ${count === 1 ? word : words}`;
export const errorMessage = (e: unknown) => e instanceof Error ? e.message : String(e);

// Browser storage is a convenience only: it may be unavailable (private mode, blocked storage).
export function readPreference(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function writePreference(key: string, value: string | null) {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* ignore */ }
}
