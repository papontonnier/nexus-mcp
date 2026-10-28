import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { analyzeDataStructure } from "@nexus/integration-hub";

const server = new McpServer({ name: "nexus-mcp", version: "0.1.0" });
server.tool("analyze_data_structure", "Analyze a JSON document's field structure", {
  json: z.string().max(1_000_000).describe("JSON document as a string")
}, async ({ json }) => {
  try {
    const result = analyzeDataStructure(JSON.parse(json));
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Analysis failed" }] };
  }
});
await server.connect(new StdioServerTransport());
