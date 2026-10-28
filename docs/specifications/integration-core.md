# Integration Core (v0.2 proposal)

## Tools
- `analyze_data_structure`: inspect nested JSON structure.
- `analyze_csv`: parse comma-separated (or custom single-character delimiter) CSV and infer primitive column types.
- `compare_json_schemas`: compare field paths and primitive types of two representative JSON documents.

## HTTP endpoints
- `POST /api/analyze/json` with a JSON body.
- `POST /api/analyze/csv` with `{"csv":"a,b\\n1,2","delimiter":","}`.
- `POST /api/compare/json` with `{"source":{"a":1},"target":{"a":"1"}}`.

## Known limitations
- JSON analysis samples only the first element of arrays; it does not infer full schemas.
- CSV inference is heuristic; quoted line breaks are supported but invalid edge-case CSV may require more validation.
- No XML parsing, mapping editor, or remote access in this increment.
- The web interface still exposes only the original JSON analysis action.
- Errors and payload validation require additional hardening before production use.

## Local verification
Run `pnpm install`, `pnpm build`, `pnpm test`, and `pnpm typecheck`. Validate both new MCP tools using a local MCP client. These checks have not been executed automatically.
