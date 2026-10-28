import type { FastifyPluginAsync } from "fastify";
import {
  analyzeFinancialDataset, FinanceError, prepareFinanceMapping, TEMPLATES, validateFinancialDimensions,
  type DatasetInput, type DimensionRule, type MappingRequest
} from "@nexus/finance-solutions";

const dataset = {
  type: "object", required: ["content"], additionalProperties: false, properties: {
    content: { type: "string", minLength: 1, maxLength: 5_000_000 }, format: { enum: ["csv", "json", "auto"] },
    delimiter: { type: "string", minLength: 1, maxLength: 1 }, decimalSeparator: { enum: [".", ",", "auto"] }
  }
} as const;

/** Stateless Finance Solutions routes under /api/finance: datasets are processed in memory and never stored. */
export const financeRoutes: FastifyPluginAsync = async app => {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof FinanceError) return reply.code(400).send({ error: error.message, code: error.code });
    if ((error as { validation?: unknown }).validation) return reply.code(400).send({ error: (error as Error).message, code: "INVALID_INPUT" });
    request.log.error(error);
    return reply.code(500).send({ error: "Finance Solutions could not complete the request", code: "INTERNAL_ERROR" });
  });
  app.get("/templates", async () => TEMPLATES);
  app.post<{ Body: DatasetInput }>("/analyze", { schema: { body: dataset } }, async request => analyzeFinancialDataset(request.body));
  app.post<{ Body: { dataset: DatasetInput; rules?: DimensionRule[] } }>("/dimensions", {
    schema: { body: { type: "object", required: ["dataset"], additionalProperties: false, properties: { dataset, rules: { type: "array", maxItems: 30, items: { type: "object", required: ["column"] } } } } }
  }, async request => validateFinancialDimensions(request.body));
  app.post<{ Body: MappingRequest }>("/mapping", {
    schema: { body: { type: "object", required: ["dataset", "target"], additionalProperties: false, properties: {
      dataset, target: { anyOf: [{ type: "string", maxLength: 64 }, { type: "object", required: ["fields"] }] },
      mappings: { type: "array", maxItems: 50, items: { type: "object", required: ["target"] } },
      previewRows: { type: "integer", minimum: 1, maximum: 50 }, includeData: { type: "boolean" }
    } } }
  }, async request => prepareFinanceMapping(request.body));
};
