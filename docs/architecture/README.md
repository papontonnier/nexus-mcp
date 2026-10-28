# Architecture decisions

- MCP uses stdio locally; remote MCP transport and authentication are deferred.
- The web app calls the Fastify API; both MCP and API import the same domain package.
- API binds to localhost only. Do not expose it publicly without authentication, authorization, and network hardening.
- JSON analysis is deterministic; no LLM API keys or model billing required.
- Implemented modules: Integration Hub (v0.2–v0.4), Knowledge Engine (v0.5), Developer Toolkit (v0.6), Finance Solutions (v0.7). Agent Lab and API Explorer remain planned.
- Domain packages may build on each other: `@nexus/finance-solutions` reuses the Integration Hub CSV parser rather than duplicating it.
- Finance Solutions is stateless: datasets are sent with each request and never stored.

## Module layout (progressive migration)
New modules register themselves instead of growing the entry points. Existing Integration Hub and Knowledge Engine code is unchanged and can be migrated later.

| Layer | Pattern | First user |
|---|---|---|
| Domain | `packages/<module>/` — framework-free logic, public types in `src/types.ts` | `@nexus/developer-toolkit`, `@nexus/finance-solutions` |
| API | `apps/api/src/routes/<module>.ts` — Fastify plugin with its own error handler, registered with a prefix | `/api/developer` |
| MCP | `apps/mcp-server/src/tools/<module>.ts` — `register<Module>Tools(server)` | Developer Toolkit tools |
| Web | `apps/web/src/modules/<module>/` — workspace, sub-views, API client, styles | `modules/developer` |

The web app imports domain **types only** (`import type … from "@nexus/<module>/types"`) so API, MCP and UI share one contract without bundling Node code.

## Local filesystem access
Modules that read the owner's files (Developer Toolkit) only work inside directories listed in a private, Git-ignored configuration file under `.nexus/`. API and MCP clients address projects by ID and cannot widen that list. See `docs/specifications/developer-toolkit.md`.
