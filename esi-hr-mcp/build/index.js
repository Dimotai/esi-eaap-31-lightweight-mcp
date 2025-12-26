import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { BedrockAgentRuntimeClient, RetrieveCommand, } from "@aws-sdk/client-bedrock-agent-runtime";
// --- AWS / KB config ----
const region = process.env.AWS_REGION || "us-east-1";
const knowledgeBaseId = process.env.HR_KB_ID;
if (!knowledgeBaseId) {
    console.error("HR_KB_ID env var is required");
    process.exit(1);
}
const defaultTopK = Number(process.env.HR_KB_DEFAULT_TOP_K || "8");
const defaultScoreThreshold = Number(process.env.HR_KB_DEFAULT_SCORE_THRESHOLD || "0.0");
// Bedrock client (will use your normal AWS credentials / role)
const bedrockClient = new BedrockAgentRuntimeClient({ region });
// --- MCP server setup ----
const server = new McpServer({
    name: "esi-hr-kb-server",
    version: "0.1.0",
});
server.registerTool("retrieve_hr_policy", {
    description: "Searches the ESI HR knowledge base (handbook, PTO, benefits, etc.) and returns ranked chunks + scores.",
    inputSchema: {
        query: z
            .string()
            .min(1, "A natural-language question is required.")
            .describe("The HR question or search query."),
        topK: z
            .number()
            .int()
            .positive()
            .max(50)
            .optional()
            .describe("Maximum number of results to return (default from env)."),
        scoreThreshold: z
            .number()
            .min(0)
            .max(1)
            .optional()
            .describe("Minimum similarity score (0–1) for a result to be included."),
    },
}, async (input) => {
    const { query, topK, scoreThreshold } = input;
    const effectiveTopK = topK ?? defaultTopK;
    const effectiveThreshold = scoreThreshold ?? (!Number.isNaN(defaultScoreThreshold) ? defaultScoreThreshold : undefined);
    const retrieveInput = {
        knowledgeBaseId,
        retrievalQuery: {
            text: query,
        },
        retrievalConfiguration: {
            vectorSearchConfiguration: {
                numberOfResults: effectiveTopK,
                ...(effectiveThreshold !== undefined
                    ? { overrideSimilarityThreshold: effectiveThreshold }
                    : {}),
            },
        },
    };
    const response = await bedrockClient.send(new RetrieveCommand(retrieveInput));
    const results = (response.retrievalResults ?? []).map((r, idx) => ({
        rank: idx + 1,
        score: r.score,
        text: r.content?.text,
        location: r.location,
        metadata: r.metadata,
    }));
    return {
        structuredContent: {
            query,
            hitCount: results.length,
            results,
        },
        content: [
            {
                type: "text",
                text: results.length === 0
                    ? `No HR knowledge-base results found for: "${query}".`
                    : `Retrieved ${results.length} HR knowledge-base chunks for: "${query}".`,
            },
        ],
        _meta: {
            bedrockRawResponse: response,
        },
    };
});
// Wire up STDIO transport (for MCP hosts like Claude Desktop / mcp-inspector)
const transport = new StdioServerTransport();
async function main() {
    await server.connect(transport);
    console.error("esi-hr-kb-server MCP up on stdio");
}
main().catch((err) => {
    console.error("Fatal error starting MCP server:", err);
    process.exit(1);
});
