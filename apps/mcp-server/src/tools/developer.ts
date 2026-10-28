import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DeveloperToolkit, DeveloperToolkitError } from "@nexus/developer-toolkit";

const projectId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/).describe("Project ID returned by list_developer_projects");
// Every Developer Toolkit tool is read-only and limited to the owner's allowlist.
const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

async function run(task: () => Promise<unknown>) {
  try { return { content: [{ type: "text" as const, text: JSON.stringify(await task(), null, 2) }] }; }
  catch (e) {
    const text = e instanceof DeveloperToolkitError ? `${e.code}: ${e.message}` : String(e);
    return { isError: true, content: [{ type: "text" as const, text }] };
  }
}

export function registerDeveloperTools(server: McpServer, toolkit = new DeveloperToolkit()) {
  server.registerTool("list_developer_projects", {
    title: "List developer projects",
    description: "List the local projects the owner allowed in the Developer Toolkit configuration file. Only these projects can be inspected; projects cannot be added through MCP.",
    annotations
  }, async () => run(() => toolkit.listProjects()));

  server.registerTool("inspect_project", {
    title: "Inspect project",
    description: "Read-only overview of an allowed project: languages, frameworks, build tools, package managers, configuration files and dependency manifests. Generated and vendored directories (node_modules, .git, dist, build, target…) are skipped.",
    inputSchema: { projectId },
    annotations
  }, async ({ projectId }) => run(() => toolkit.inspectProject(projectId)));

  server.registerTool("analyze_dependencies", {
    title: "Analyze dependencies",
    description: "List declared dependencies with versions and scopes (production, development, peer, optional, provided, build, managed) from package.json, pom.xml, build.gradle(.kts), requirements*.txt and pyproject.toml files of an allowed project.",
    inputSchema: { projectId },
    annotations
  }, async ({ projectId }) => run(() => toolkit.analyzeDependencies(projectId)));

  server.registerTool("get_project_structure", {
    title: "Get project structure",
    description: "Browse an allowed project's directory tree, or search it by file name (query; include '/' to match paths) and/or extensions. Returns metadata only (name, type, size, modification date); file contents are never returned.",
    inputSchema: {
      projectId,
      path: z.string().max(1024).optional().describe("Directory relative to the project root, e.g. src/routes. Defaults to the root."),
      depth: z.number().int().min(1).max(5).optional().describe("Tree depth (1–5, default 2). Ignored when searching."),
      query: z.string().max(120).optional().describe("Case-insensitive file or folder name fragment"),
      extensions: z.array(z.string().max(16)).max(20).optional().describe("File extensions to keep, e.g. [\"ts\", \"java\"]"),
      limit: z.number().int().min(1).max(500).optional().describe("Maximum search results (default 200)")
    },
    annotations
  }, async ({ projectId, ...options }) => run(() => toolkit.getProjectStructure(projectId, options)));
}
