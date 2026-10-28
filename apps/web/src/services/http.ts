/** Fetches JSON from the NEXUS API and turns API or network failures into readable errors. */
export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (data && typeof data === "object" && "error" in data) throw new Error(String(data.error));
    throw new Error(response.status >= 500 ? `NEXUS API unavailable (${response.status}). Start it with: pnpm --filter @nexus/api dev` : `Request failed (${response.status})`);
  }
  if (data === null) throw new Error("The NEXUS API returned an empty response.");
  return data as T;
}
