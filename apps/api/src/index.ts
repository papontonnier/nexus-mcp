import Fastify from "fastify";
import { analyzeDataStructure } from "@nexus/integration-hub";
const app = Fastify({ logger: true, bodyLimit: 1_000_000 });
app.get("/health", async () => ({ status: "ok", service: "nexus-api" }));
app.post("/api/analyze/json", async (request) => analyzeDataStructure(request.body));
await app.listen({ port: 3001, host: "127.0.0.1" });
