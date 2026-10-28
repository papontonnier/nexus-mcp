import type { FastifyPluginAsync } from "fastify";
import { DeveloperToolkitError, type DeveloperToolkit, type ErrorCode } from "@nexus/developer-toolkit";

const STATUS: Record<ErrorCode, number> = {
  PROJECT_NOT_FOUND: 404, PROJECT_UNAVAILABLE: 409, INVALID_INPUT: 400, INVALID_PATH: 400,
  PATH_OUTSIDE_PROJECT: 403, EXCLUDED_PATH: 403, PATH_NOT_FOUND: 404, NOT_A_DIRECTORY: 400
};
const params = { type: "object", required: ["id"], properties: { id: { type: "string", pattern: "^[a-z0-9][a-z0-9-]{0,63}$" } } } as const;
const structureQuery = {
  type: "object", additionalProperties: false, properties: {
    path: { type: "string", maxLength: 1024 }, depth: { type: "integer", minimum: 1, maximum: 5 },
    q: { type: "string", maxLength: 120 }, ext: { type: "string", maxLength: 400, pattern: "^[A-Za-z0-9., ]*$" },
    limit: { type: "integer", minimum: 1, maximum: 500 }
  }
} as const;
type Params = { Params: { id: string } };
type StructureQuery = { path?: string; depth?: number; q?: string; ext?: string; limit?: number };

/** Read-only Developer Toolkit routes, registered under /api/developer. Errors are scoped to this plugin. */
export const developerRoutes: FastifyPluginAsync<{ toolkit: DeveloperToolkit }> = async (app, { toolkit }) => {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof DeveloperToolkitError) return reply.code(STATUS[error.code]).send({ error: error.message, code: error.code });
    if ((error as { validation?: unknown }).validation) return reply.code(400).send({ error: (error as Error).message, code: "INVALID_INPUT" });
    request.log.error(error);
    return reply.code(500).send({ error: "Developer Toolkit could not complete the request", code: "INTERNAL_ERROR" });
  });
  app.get("/projects", async () => toolkit.listProjects());
  app.get<Params>("/projects/:id/inspect", { schema: { params } }, async request => toolkit.inspectProject(request.params.id));
  app.get<Params>("/projects/:id/dependencies", { schema: { params } }, async request => toolkit.analyzeDependencies(request.params.id));
  app.get<Params & { Querystring: StructureQuery }>("/projects/:id/structure", { schema: { params, querystring: structureQuery } }, async request => {
    const { path, depth, q, ext, limit } = request.query;
    const extensions = ext?.split(/[\s,]+/).filter(Boolean);
    return toolkit.getProjectStructure(request.params.id, { path, depth, query: q, extensions: extensions?.length ? extensions : undefined, limit });
  });
};
