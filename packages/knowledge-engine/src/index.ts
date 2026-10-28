import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import pdf from "pdf-parse";

export type DocumentFormat = "txt" | "md" | "pdf";
export type DocumentVersion = { version: number; createdAt: string; hash: string; size: number };
export type DocumentInfo = { id: string; name: string; format: DocumentFormat; createdAt: string; updatedAt: string; currentVersion: number; versions: DocumentVersion[] };
export type SearchHit = { id: string; name: string; format: DocumentFormat; version: number; score: number; snippet: string };
export type DocumentDetail = DocumentInfo & { content: string };
const MAX_BYTES = 5_000_000;
const MAX_DOCS = 1000;
const MAX_EXTRACTED = 1_000_000;
const isValidId = (id: string) => /^[0-9a-f-]{36}$/.test(id);
function validateName(name: string): DocumentFormat {
  if (name.length > 180 || !name.trim() || /[\\/\x00-\x1f]/.test(name)) throw new Error("Invalid document name");
  const ext = path.extname(name).toLowerCase().slice(1);
  if (ext !== "txt" && ext !== "md" && ext !== "pdf") throw new Error("Supported formats: .txt, .md, .pdf");
  return ext;
}
function tokens(text: string): string[] { return (text.normalize("NFKC").toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(t => t.length > 1); }
function snippet(text: string, term: string): string {
  const lower = text.toLocaleLowerCase(), pos = Math.max(0, lower.indexOf(term.toLocaleLowerCase()));
  const start = Math.max(0, pos - 90);
  return (start ? "…" : "") + text.slice(start, start + 260).replace(/\s+/g, " ").trim() + (start + 260 < text.length ? "…" : "");
}
export class KnowledgeStore {
  private readonly root: string;
  constructor(root = process.env.NEXUS_KNOWLEDGE_DIR || path.resolve(process.cwd(), ".nexus", "knowledge")) { this.root = path.resolve(root); }
  private dir(id: string) { if (!isValidId(id)) throw new Error("Invalid document ID"); return path.join(this.root, id); }
  private async metadata(id: string): Promise<DocumentInfo> {
    try { return JSON.parse(await readFile(path.join(this.dir(id), "metadata.json"), "utf8")) as DocumentInfo; }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") throw new Error("Document not found"); throw e; }
  }
  async list(): Promise<DocumentInfo[]> {
    await mkdir(this.root, { recursive: true });
    const entries = await readdir(this.root, { withFileTypes: true });
    const docs = await Promise.all(entries.filter(e => e.isDirectory() && isValidId(e.name)).map(async e => {
      try { return await this.metadata(e.name); } catch { return null; }
    }));
    return docs.filter((d): d is DocumentInfo => d !== null).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async import(name: string, data: Uint8Array, existingId?: string): Promise<DocumentInfo> {
    const format = validateName(name);
    if (!data.length || data.byteLength > MAX_BYTES) throw new Error("Document must be 1 byte to 5 MB");
    const text = format === "pdf" ? (await pdf(Buffer.from(data))).text : new TextDecoder("utf-8", { fatal: true }).decode(data);
    if (!text.trim()) throw new Error("Document contains no extractable text");
    if (text.length > MAX_EXTRACTED) throw new Error("Extracted text exceeds 1 million characters");
    const old = existingId ? await this.metadata(existingId) : null;
    if (old && old.name !== name) throw new Error("Document name must match when creating a new version");
    if (!old && (await this.list()).length >= MAX_DOCS) throw new Error("Document limit reached");
    const id = old?.id ?? randomUUID(), version = (old?.currentVersion ?? 0) + 1;
    const createdAt = new Date().toISOString();
    const hash = createHash("sha256").update(data).digest("hex");
    const dir = this.dir(id);
    await mkdir(dir, { recursive: true });
    const record: DocumentInfo = { id, name, format, createdAt: old?.createdAt ?? createdAt, updatedAt: createdAt, currentVersion: version, versions: [...(old?.versions ?? []), { version, createdAt, hash, size: data.byteLength }] };
    await writeFile(path.join(dir, `v${version}.txt`), text, { flag: "wx" });
    const temp = path.join(dir, "metadata.tmp");
    await writeFile(temp, JSON.stringify(record, null, 2));
    await rename(temp, path.join(dir, "metadata.json"));
    return record;
  }
  async get(id: string, version?: number): Promise<DocumentDetail> {
    const record = await this.metadata(id);
    const selected = version ?? record.currentVersion;
    if (!Number.isInteger(selected) || !record.versions.some(v => v.version === selected)) throw new Error("Version not found");
    const content = await readFile(path.join(this.dir(id), `v${selected}.txt`), "utf8");
    return { ...record, currentVersion: selected, content };
  }
  async remove(id: string): Promise<void> { await this.metadata(id); await rm(this.dir(id), { recursive: true, force: true }); }
  async search(query: string, limit = 20): Promise<SearchHit[]> {
    const terms = [...new Set(tokens(query))].slice(0, 12);
    if (!terms.length || query.length > 250) throw new Error("Enter a search query of 2–250 characters");
    const docs = await this.list();
    const hits = await Promise.all(docs.map(async d => {
      const { content } = await this.get(d.id);
      const normalized = content.normalize("NFKC").toLocaleLowerCase();
      const name = d.name.toLocaleLowerCase();
      const scores = terms.map(term => {
        const occurrences = normalized.split(term).length - 1;
        return Math.min(occurrences, 20) + (name.includes(term) ? 8 : 0);
      });
      if (scores.some(score => score === 0)) return null;
      const score = scores.reduce((a,b) => a+b,0);
      const first = terms.find(t => normalized.includes(t)) ?? terms[0];
      return { id: d.id, name: d.name, format: d.format, version: d.currentVersion, score, snippet: snippet(content, first) };
    }));
    return hits.filter((h): h is SearchHit => h !== null).sort((a,b) => b.score-a.score).slice(0, Math.max(1, Math.min(limit, 100)));
  }
}
