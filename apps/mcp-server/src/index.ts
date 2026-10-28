import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { analyzeDataStructure } from "@nexus/integration-hub";
import { analyzeCsv } from "@nexus/integration-hub/csv";
import { compareJsonSchemas } from "@nexus/integration-hub/compare";

const server = new McpServer({ name: "nexus-mcp", version: "0.2.0" });
server.tool("analyze_data_structure", "Analyze a JSON document's field structure", {
  json: z.string().max(1_000_000)
}, async ({ json }) => {
  try { return { content: [{ type: "text" as const, text: JSON.stringify(analyzeDataStructure(JSON.parse(json)), null, 2) }] }; }
  catch (error) { return { isError: true, content: [{ type: "text" as const, text: String(error) }] }; }
});
server.tool("analyze_csv", "Analyze CSV columns and missing values", {
  csv: z.string().max(1_000_000), delimiter: z.string().length(1).default(",")
}, async ({ csv, delimiter }) => {
  try { return { content: [{ type: "text" as const, text: JSON.stringify(analyzeCsv(csv, delimiter), null, 2) }] }; }
  catch (error) { return { isError: true, content: [{ type: "text" as const, text: String(error) }] }; }
});
server.tool("compare_json_schemas", "Compare structures of two JSON documents", {
  source: z.string().max(1_000_000), target: z.string().max(1_000_000)
}, async ({ source, target }) => {
  try { return { content: [{ type: "text" as const, text: JSON.stringify(compareJsonSchemas(JSON.parse(source), JSON.parse(target)), null, 2) }] }; }
  catch (error) { return { isError: true, content: [{ type: "text" as const, text: String(error) }] }; }
});
await server.connect(new StdioServerTransport());
