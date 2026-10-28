# NEXUS Web v0.3

## Scope
- Responsive six-module navigation, overview dashboard and module roadmap placeholders.
- Integration Hub workspace connected to existing Fastify endpoints:
  - JSON structure analysis.
  - CSV analysis with selectable delimiter.
  - JSON schema comparison via a JSON object containing `source` and `target`.
- Analysis output, error feedback, copy-to-clipboard, and last eight successful runs in **in-memory session state only**.
- Light/dark theme toggle persisted to localStorage.
- Responsive sidebar navigation suitable for narrow phone screens and unfolded tablet-like screens.

## Constraints and caveats
- Five modules are navigation placeholders, not functional implementations.
- Dashboard's available tools count is static; local indicator is not a live health check.
- No persistence of analysis history across page reloads.
- No user authentication or remote deployment. Run API on localhost only.
- The UI loads a Google Fonts stylesheet; remove the import for fully offline operation.

## Manual acceptance
1. `pnpm install && pnpm build && pnpm test && pnpm typecheck`.
2. Start API and web dev servers.
3. Test JSON, CSV and compare tabs against the corresponding endpoints.
4. Verify invalid JSON and unavailable backend show an error.
5. Check narrow (360px), outer foldable (~430px), inner foldable (~760px), and desktop widths.
6. Toggle theme and reload.
7. Navigate all six modules, including placeholder labels.

This branch has not been locally compiled or manually tested.
