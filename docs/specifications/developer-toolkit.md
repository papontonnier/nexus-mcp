# Developer Toolkit — v0.6

## Scope
Read-only inspection of local software projects that the owner explicitly allows. One shared package, `@nexus/developer-toolkit`, serves the Fastify API, the MCP server and (through type-only imports) the React workspace. No paid LLM APIs: every result is deterministic.

### Capabilities
- **Project allowlist** — projects come from a local configuration file edited by the owner only.
- **Inspection** — languages (share of code by size), frameworks and libraries, build tools, package managers, configuration files, dependency manifests, monorepo detection and a one-sentence stack summary.
- **Dependency analysis** — declared dependencies with version, scope and source manifest from:
  `package.json`, `pom.xml`, `build.gradle`, `build.gradle.kts`, `requirements*.txt` (`requirements.txt`, `requirements-dev.txt`, `dev-requirements.txt`, …) and `pyproject.toml` (PEP 621, optional dependencies, dependency groups, Poetry, uv, build system).
  Lockfiles (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `poetry.lock`, `uv.lock`, …) identify package managers; they are not parsed.
  Scopes: `production`, `development`, `peer`, `optional`, `provided`, `build`, `managed` (BOM / dependencyManagement / Gradle platform). Packages declared by another manifest of the same project are flagged `internal`.
- **Structure exploration** — directory tree (depth 1–5) or search by name, path fragment (when the query contains `/`) and extensions, with size and modification date.

## Configuration
Default file: `.nexus/developer/projects.json` at the repository root (ignored by Git, like the Knowledge store). Override with `NEXUS_DEV_PROJECTS_FILE`.

```json
{
  "projects": [
    { "name": "nexus-mcp", "path": "C:/Users/you/IdeaProjects/nexus-mcp", "description": "This workspace" },
    { "id": "billing", "name": "Billing service", "path": "D:/dev/billing-service" }
  ]
}
```

- `path` must be absolute. On Windows use forward slashes or escaped backslashes (`C:\\dev\\app`).
- `id` is optional; it defaults to a slug of `name` (lowercase letters, digits, dashes, max 64).
- The file is re-read on every request: edit it, then click **Reload** — no restart needed.
- Up to 50 projects. Entries with a missing directory, a relative path, a file instead of a directory or a filesystem root (`C:\`, `/`) are listed as unavailable with the reason.

## Security model
| Threat | Mitigation |
|---|---|
| Arbitrary file access via MCP/API | Tools take a **project ID**, never an absolute path. Projects can only be added by editing the local file; there is no API or MCP tool to register a folder. |
| Path traversal | Client paths must be relative; `..` segments, absolute, drive (`C:`), UNC (`\\server`), NTFS stream (`file:stream`) and control characters are rejected before touching the disk. |
| Symbolic links / Windows junctions | The target is resolved with `realpath` and must stay inside the project root. Recursive walks never follow links. |
| Secrets | File **contents are never returned**. Only known dependency manifests are read, and only parsed fields are returned. Credentials embedded in URLs are redacted (`https://***@host`), pip `--index-url` options are never echoed. `.env*`, keys, keystores, `.npmrc`, `credentials*`, `secrets*`… are flagged `sensitive` in listings. |
| Excluded directories | `node_modules`, `.git`, `dist`, `build`, `target`, `coverage`, `.next`, `.venv`, `venv`, `.nexus`, `.idea`, `.gradle`, caches… are never entered and cannot be opened explicitly. |
| Oversized files | Manifests larger than 1 MB are skipped with a warning. |
| Uncontrolled recursion | Walks are breadth-first and bounded: 25,000 entries, depth 16, 60 manifests, 2,000 tree nodes, 500 search results. Truncation is reported (`truncated: true`). |
| Malicious manifests | No XML parser (no DTD/XXE), a bounded TOML reader with null-prototype objects (no prototype pollution), parsing errors become warnings. |

The API keeps its localhost-only binding and has **no authentication**: do not expose it on a network.

## API
All routes are `GET`, read-only, under `/api/developer` (`apps/api/src/routes/developer.ts`).

| Route | Result |
|---|---|
| `/projects` | `ProjectCatalog` — config path, projects with status (`ready`, `missing`, `invalid`), issues |
| `/projects/:id/inspect` | `ProjectInspection` |
| `/projects/:id/dependencies` | `DependencyAnalysis` |
| `/projects/:id/structure?path=src&depth=2` | `ProjectTree` (`mode: "tree"`) |
| `/projects/:id/structure?path=src&q=controller&ext=ts,tsx&limit=100` | `ProjectFileSearch` (`mode: "search"`) |

Errors return `{ "error": string, "code": string }`: `INVALID_INPUT` / `INVALID_PATH` / `NOT_A_DIRECTORY` → 400, `PATH_OUTSIDE_PROJECT` / `EXCLUDED_PATH` → 403, `PROJECT_NOT_FOUND` / `PATH_NOT_FOUND` → 404, `PROJECT_UNAVAILABLE` → 409.

## MCP
Registered from `apps/mcp-server/src/tools/developer.ts` with `readOnlyHint: true` and `openWorldHint: false`.

| Tool | Input |
|---|---|
| `list_developer_projects` | — |
| `inspect_project` | `projectId` |
| `analyze_dependencies` | `projectId` |
| `get_project_structure` | `projectId`, optional `path`, `depth` (1–5), `query`, `extensions[]`, `limit` |

Errors are returned as `isError` results: `CODE: message`. The MCP server now exposes **11 tools** and reports version `0.6.0`.

Example MCP client configuration (e.g. Claude Desktop on Windows):

```json
{
  "mcpServers": {
    "nexus": {
      "command": "node",
      "args": ["C:/Users/you/IdeaProjects/nexus-mcp/apps/mcp-server/dist/index.js"]
    }
  }
}
```

Set `"env": { "NEXUS_DEV_PROJECTS_FILE": "…" }` only to use another configuration file; by default the API and MCP share `.nexus/developer/projects.json`.

## Web workspace
`apps/web/src/modules/developer/` — first module following the `modules/` structure from the architecture roadmap.
- Allowed projects with status, and a setup card (file path + example) when none is configured.
- **Overview**: stack summary, language bar (validated colorblind-safe palette in light and dark, legend with values, hover tooltip), frameworks, build tools, package managers, configuration files, skipped folders.
- **Files**: breadcrumb navigation, search, extension filter, metadata, `sensitive` / `excluded` / `link` badges.
- **Dependencies**: filters by name, scope and manifest; ecosystem summary; parsing notes.
- Last selected project is remembered in `localStorage` (convenience only).

## Known limitations
- Dependency detection is static and declarative: no resolution of transitive dependencies, lockfile versions, Maven parent POM inheritance beyond the parent version, `<profiles>`, Gradle version catalogs (`libs.*` names are listed without version) or variables defined outside the build file.
- `.gitignore` rules are not applied; only the fixed exclusion list is.
- Framework detection relies on a curated list of well-known packages.
- Every request rescans the project (no cache or index yet); very large repositories are truncated by the limits above.
- On Windows, reparse points (symbolic links, junctions and possibly cloud placeholders such as OneDrive online-only files) are treated as links: listed, never followed or counted.
- The test suite was run on Linux. Windows path rules (drive letters, UNC paths, junctions) are covered by tests, but the suite has not yet been run on Windows.

## Verification
1. `pnpm install`, `pnpm build`, `pnpm test`, `pnpm typecheck`.
2. Create `.nexus/developer/projects.json` with one or more local projects, start `pnpm dev`.
3. Developer Toolkit → select a project → check Overview, Files (navigate, search, extension filter) and Dependencies (filters).
4. Try a missing directory in the configuration: the card shows *Not found* and cannot be opened.
5. Through an MCP client: `list_developer_projects`, then `inspect_project`, `analyze_dependencies`, `get_project_structure` (also with `path: "../"` → `PATH_OUTSIDE_PROJECT`).
6. Check phone (~375 px), unfolded (~760 px) and desktop widths in both themes.
