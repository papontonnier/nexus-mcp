# Knowledge Engine — v0.5

## Scope
A local-first knowledge library for TXT, Markdown and text-based PDFs. The same `@nexus/knowledge-engine` package serves Fastify and MCP. No paid LLM APIs.

### Capabilities
- Import a TXT/MD/PDF file (max 5 MB).
- Extract PDF text; scanned PDFs **do not** have OCR support.
- Store extracted text, SHA-256 hash, metadata and immutable document versions.
- List, read, search and delete documents.
- Create new versions by importing a file with the same name and a known document ID.
- Full-text keyword search (case-insensitive, Unicode-normalized; all query terms must match) with ranked snippets. This is **not semantic/vector search**.
- React UI for importing, searching, reading, switching versions and deleting.

### Storage
Files live in `.nexus/knowledge/<uuid>/` at the repository root, ignored by Git. Set `NEXUS_KNOWLEDGE_DIR` for an alternative location. Each version is a UTF-8 text snapshot and metadata is written through a temporary file then renamed. The API and MCP share the same default path.

This file-based implementation is intended for **one local user**. Concurrent writes to the same document are not locked; use a database and transactions if multi-user or concurrent writes become necessary.

### API
- `GET /api/knowledge/documents`
- `GET /api/knowledge/documents/:id?version=1`
- `GET /api/knowledge/search?q=forecast&limit=20`
- `POST /api/knowledge/import` with JSON `{"name":"notes.md","contentBase64":"...","documentId":"optional-existing-id"}`
- `DELETE /api/knowledge/documents/:id`

### MCP
- `list_knowledge_sources`
- `search_knowledge`
- `get_document`
- `import_knowledge_document`

### Security and limitations
- Localhost-only Fastify binding. **No authentication**; do not expose the API to public networks.
- Imported text may be sensitive. Do not commit the `.nexus/` directory or share its contents.
- PDF extraction uses the `pdf-parse` library and is not a sandbox for untrusted PDFs.
- Import limit: 5 MB original, 1 million extracted characters, 1,000 documents; content returned to MCP can still be large.
- Search reads local files; it does not currently use SQLite FTS, embeddings or semantic retrieval.
- Only extracted text is retained, not the original binary PDF.
- Version history is per document ID and requires the same filename.
- Deleting a document deletes all versions permanently.

### Verification before merge
1. `pnpm install`, `pnpm build`, `pnpm test`, `pnpm typecheck`.
2. Run API and web. Import TXT, Markdown and text-based PDF; search for terms and open hits.
3. Upload a new version of an existing document; switch between versions.
4. Delete and verify document disappears from list and search.
5. Check invalid extension, oversized file, malformed PDF, and invalid search input.
6. Confirm MCP tools see documents imported via the web app.
7. Test narrow phone and unfolded layouts, both themes.
8. Confirm `.nexus/` is ignored by Git.

**Not yet executed in this PR:** local compilation, runtime tests, PDF extraction verification and browser QA.
