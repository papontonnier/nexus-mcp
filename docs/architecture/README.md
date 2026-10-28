# Architecture decisions

- MCP uses stdio locally; remote MCP transport and authentication are deferred.
- The web app calls the Fastify API; both MCP and API import the same domain package.
- API binds to localhost only. Do not expose it publicly without authentication, authorization, and network hardening.
- JSON analysis is deterministic; no LLM API keys or model billing required.
- Integration Hub is the first implemented module; other five modules remain planned.
