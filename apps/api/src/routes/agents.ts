import type { FastifyPluginAsync } from "fastify";
import { AgentLabError, type AgentLab, type AgentLabErrorCode, type WorkflowDefinition } from "@nexus/agent-lab";

const STATUS: Record<AgentLabErrorCode, number> = {
  WORKFLOW_NOT_FOUND: 404, RUN_NOT_FOUND: 404, INVALID_WORKFLOW: 400, INVALID_INPUT: 400,
  CONFIRMATION_REQUIRED: 409, INPUTS_NOT_STORED: 409, READ_ONLY_WORKFLOW: 403
};
const id = { type: "object", required: ["id"], properties: { id: { type: "string", maxLength: 64 } } } as const;
const runBody = {
  type: "object", required: ["workflowId"], additionalProperties: false,
  properties: { workflowId: { type: "string", maxLength: 64 }, inputs: { type: "object" }, confirmSensitive: { type: "boolean" } }
} as const;

/** Agent Lab routes under /api/agents. Runs execute in this process with the same limits as MCP. */
export const agentRoutes: FastifyPluginAsync<{ lab: AgentLab }> = async (app, { lab }) => {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AgentLabError) return reply.code(STATUS[error.code]).send({ error: error.message, code: error.code, ...error.details });
    if ((error as { validation?: unknown }).validation) return reply.code(400).send({ error: (error as Error).message, code: "INVALID_INPUT" });
    request.log.error(error);
    return reply.code(500).send({ error: "Agent Lab could not complete the request", code: "INTERNAL_ERROR" });
  });
  app.get("/tools", async () => lab.listTools());
  app.get("/workflows", async () => lab.listWorkflows());
  app.post<{ Body: WorkflowDefinition }>("/workflows/validate", async request => ({ issues: lab.validate(request.body) }));
  app.get<{ Params: { id: string } }>("/workflows/:id", { schema: { params: id } }, async request => lab.getWorkflow(request.params.id));
  app.put<{ Params: { id: string }; Body: WorkflowDefinition }>("/workflows/:id", { schema: { params: id, body: { type: "object" } } }, async request => {
    if (request.body.id !== request.params.id) throw new AgentLabError("INVALID_WORKFLOW", "The workflow ID in the body must match the URL");
    return lab.saveWorkflow(request.body);
  });
  app.delete<{ Params: { id: string } }>("/workflows/:id", { schema: { params: id } }, async request => { await lab.deleteWorkflow(request.params.id); return { deleted: true }; });
  app.post<{ Body: { workflowId: string; inputs?: Record<string, unknown>; confirmSensitive?: boolean } }>("/runs", { schema: { body: runBody } }, async request => lab.run(request.body));
  app.get<{ Querystring: { workflowId?: string; limit?: number } }>("/runs", {
    schema: { querystring: { type: "object", properties: { workflowId: { type: "string", maxLength: 64 }, limit: { type: "integer", minimum: 1, maximum: 200 } } } }
  }, async request => lab.listRuns(request.query));
  app.get<{ Params: { id: string } }>("/runs/:id", { schema: { params: id } }, async request => lab.getRun(request.params.id));
  app.post<{ Params: { id: string }; Body: { confirmSensitive?: boolean } }>("/runs/:id/rerun", {
    schema: { params: id, body: { type: "object", additionalProperties: false, properties: { confirmSensitive: { type: "boolean" } } } }
  }, async request => lab.rerun(request.params.id, request.body?.confirmSensitive === true));
  app.delete<{ Params: { id: string } }>("/runs/:id", { schema: { params: id } }, async request => { await lab.deleteRun(request.params.id); return { deleted: true }; });
};
