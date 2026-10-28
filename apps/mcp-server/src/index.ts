import { KnowledgeStore } from "@nexus/knowledge-engine";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { analyzeDataStructure } from "@nexus/integration-hub";
import { analyzeCsv } from "@nexus/integration-hub/csv";
import { compareJsonSchemas } from "@nexus/integration-hub/compare";

const server = new McpServer({ name: "nexus-mcp", version: "0.2.0" });
server.tool("analyze_data_structure", "Analyze a JSON document's field structure", {
  json: z.string().max(1_000_000)
}, async ({ json }) => {
  try { return { content: [{ type: "text" as const, text: JSON.stringify(analyzeDataStructure(JSON.parse(json)), null, 2) }] }; }
  catch (error) { return { isError: true, content: [{ type: "text" as const, text: String(error) }] }; }
});
server.tool("analyze_csv", "Analyze CSV columns and missing values", {
  csv: z.string().max(1_000_000), delimiter: z.string().length(1).default(",")
}, async ({ csv, delimiter }) => {
  try { return { content: [{ type: "text" as const, text: JSON.stringify(analyzeCsv(csv, delimiter), null, 2) }] }; }
  catch (error) { return { isError: true, content: [{ type: "text" as const, text: String(error) }] }; }
});
server.tool("compare_json_schemas", "Compare structures of two JSON documents", {
  source: z.string().max(1_000_000), target: z.string().max(1_000_000)
}, async ({ source, target }) => {
  try { return { content: [{ type: "text" as const, text: JSON.stringify(compareJsonSchemas(JSON.parse(source), JSON.parse(target)), null, 2) }] }; }
  catch (error) { return { isError: true, content: [{ type: "text" as const, text: String(error) }] }; }
});

const knowledge = new KnowledgeStore();
server.tool("list_knowledge_sources", "List imported local documents and their versions", {}, async () => {
  try { return { content: [{ type: "text" as const, text: JSON.stringify(await knowledge.list(), null, 2) }] }; }
  catch (e) { return { isError: true, content: [{ type: "text" as const, text: String(e) }] }; }
});
server.tool("search_knowledge", "Search local indexed documents", { query: z.string().min(2).max(250), limit: z.number().int().min(1).max(100).default(20) }, async ({ query, limit }) => {
  try { return { content: [{ type: "text" as const, text: JSON.stringify(await knowledge.search(query, limit), null, 2) }] }; }
  catch (e) { return { isError: true, content: [{ type: "text" as const, text: String(e) }] }; }
});
server.tool("get_document", "Read a local knowledge document and optionally an earlier version", { id: z.string().uuid(), version: z.number().int().positive().optional() }, async ({ id, version }) => {
  try { return { content: [{ type: "text" as const, text: JSON.stringify(await knowledge.get(id, version), null, 2) }] }; }
  catch (e) { return { isError: true, content: [{ type: "text" as const, text: String(e) }] }; }
});
server.tool("import_knowledge_document", "Import a TXT, MD or PDF document as base64 (max 5MB)", { name: z.string().min(1).max(180), contentBase64: z.string().max(7_000_000), documentId: z.string().uuid().optional() }, async ({ name, contentBase64, documentId }) => {
  try {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(contentBase64)) throw new Error("Invalid base64 content");
    return { content: [{ type: "text" as const, text: JSON.stringify(await knowledge.import(name, Buffer.from(contentBase64, "base64"), documentId), null, 2) }] };
  } catch (e) { return { isError: true, content: [{ type: "text" as const, text: String(e) }] }; }
});
await server.connect(new StdioServerTransport());
