import { KnowledgeStore } from "@nexus/knowledge-engine";
import { DeveloperToolkit } from "@nexus/developer-toolkit";
import Fastify from "fastify";
import { developerRoutes } from "./routes/developer.js";
import { analyzeDataStructure } from "@nexus/integration-hub";
import { analyzeCsv } from "@nexus/integration-hub/csv";
import { compareJsonSchemas } from "@nexus/integration-hub/compare";
const app = Fastify({ logger: true, bodyLimit: 7_000_000 });
app.get("/health", async () => ({ status: "ok", service: "nexus-api" }));
app.post("/api/analyze/json", async (request) => analyzeDataStructure(request.body));
app.post<{ Body: { csv: string; delimiter?: string } }>("/api/analyze/csv", {
  schema: { body: { type: "object", required: ["csv"], additionalProperties: false, properties: { csv: { type: "string", maxLength: 1000000 }, delimiter: { type: "string", minLength: 1, maxLength: 1 } } } }
}, async (request) => analyzeCsv(request.body.csv, request.body.delimiter));
app.post<{ Body: { source: unknown; target: unknown } }>("/api/compare/json", {
  schema: { body: { type: "object", required: ["source", "target"], properties: { source: {}, target: {} } } }
}, async (request) => compareJsonSchemas(request.body.source, request.body.target));

const knowledge = new KnowledgeStore();
app.get("/api/knowledge/documents", async () => knowledge.list());
app.get<{ Params: { id: string }; Querystring: { version?: string } }>("/api/knowledge/documents/:id", async (request, reply) => {
  try { const v = request.query.version ? Number(request.query.version) : undefined; return await knowledge.get(request.params.id, v); }
  catch (e) { return reply.code(404).send({ error: String(e) }); }
});
app.get<{ Querystring: { q?: string; limit?: string } }>("/api/knowledge/search", async (request, reply) => {
  try { return await knowledge.search(request.query.q ?? "", Number(request.query.limit ?? 20)); }
  catch (e) { return reply.code(400).send({ error: String(e) }); }
});
app.post<{ Body: { name: string; contentBase64: string; documentId?: string } }>("/api/knowledge/import", {
  schema: { body: { type: "object", required: ["name","contentBase64"], additionalProperties: false, properties: {
    name: { type: "string", minLength: 1, maxLength: 180 },
    contentBase64: { type: "string", minLength: 1, maxLength: 7_000_000 },
    documentId: { type: "string", maxLength: 36 }
  } } }
}, async (request, reply) => {
  try {
    const { name, contentBase64, documentId } = request.body;
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(contentBase64)) throw new Error("Invalid base64 content");
    return await knowledge.import(name, Buffer.from(contentBase64, "base64"), documentId);
  } catch (e) { return reply.code(400).send({ error: String(e) }); }
});
app.delete<{ Params: { id: string } }>("/api/knowledge/documents/:id", async (request, reply) => {
  try { await knowledge.remove(request.params.id); return { deleted: true }; }
  catch (e) { return reply.code(404).send({ error: String(e) }); }
});

await app.register(developerRoutes, { prefix: "/api/developer", toolkit: new DeveloperToolkit() });
await app.listen({ port: 3001, host: "127.0.0.1" });
