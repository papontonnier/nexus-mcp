import Fastify from "fastify";
import { analyzeDataStructure } from "@nexus/integration-hub";
import { analyzeCsv } from "@nexus/integration-hub/csv";
import { compareJsonSchemas } from "@nexus/integration-hub/compare";
const app = Fastify({ logger: true, bodyLimit: 1_000_000 });
app.get("/health", async () => ({ status: "ok", service: "nexus-api" }));
app.post("/api/analyze/json", async (request) => analyzeDataStructure(request.body));
app.post<{ Body: { csv: string; delimiter?: string } }>("/api/analyze/csv", {
  schema: { body: { type: "object", required: ["csv"], additionalProperties: false, properties: { csv: { type: "string", maxLength: 1000000 }, delimiter: { type: "string", minLength: 1, maxLength: 1 } } } }
}, async (request) => analyzeCsv(request.body.csv, request.body.delimiter));
app.post<{ Body: { source: unknown; target: unknown } }>("/api/compare/json", {
  schema: { body: { type: "object", required: ["source", "target"], properties: { source: {}, target: {} } } }
}, async (request) => compareJsonSchemas(request.body.source, request.body.target));
await app.listen({ port: 3001, host: "127.0.0.1" });
