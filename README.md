# NEXUS MCP

Modular Model Context Protocol platform for software integration, technical analysis, finance solutions, and AI experimentation.

## Modules

- Integration Hub — JSON, CSV, XML analysis and mappings
- Knowledge Engine — technical knowledge and document search
- Developer Toolkit — project inspection and diagnostics
- Finance Solutions — financial data quality, dimension checks and integration mappings (generic layouts; vendor connectors only from verified documentation)
- Agent Lab — deterministic tool workflows, with optional future agent orchestration
- API Explorer — OpenAPI inspection and payload validation

## Architecture

TypeScript monorepo: MCP server, Fastify API, React web app, and shared business services. Initial development is local-first, with optional private mobile access later. No paid LLM API keys required.

## Status

v0.8 — Integration Hub, Knowledge Engine, Developer Toolkit, Finance Solutions and Agent Lab are available; API Explorer is planned. Local, single-user use only: do not use with confidential production data until security controls are validated.

## Getting started

```bash
pnpm install
pnpm build
pnpm dev
```

The web app runs on http://127.0.0.1:5173 and the API on 127.0.0.1:3001. To let the Developer Toolkit inspect local projects, list them in `.nexus/developer/projects.json` (see `docs/specifications/developer-toolkit.md`).

## License

No license granted unless one is added explicitly.
