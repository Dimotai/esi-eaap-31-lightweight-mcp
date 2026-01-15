import "dotenv/config";
import express from "express";
import cors from "cors";
import { BedrockAgentRuntimeClient, RetrieveAndGenerateCommand, } from "@aws-sdk/client-bedrock-agent-runtime";
const app = express();
// Basic middleware
app.use(cors());
app.use(express.json());
// Serve static files from ./public
app.use(express.static("public"));
const region = process.env.AWS_REGION ?? "us-east-1";
const knowledgeBaseId = process.env.HR_KB_ID;
const modelArn = process.env.HR_CHAT_MODEL_ARN ??
    "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-sonnet-20240229-v1:0";
if (!knowledgeBaseId) {
    throw new Error("HR_KB_ID env var is required for chat server.");
}
const client = new BedrockAgentRuntimeClient({ region });
app.post("/api/chat", async (req, res) => {
    try {
        const { messages } = req.body;
        if (!messages || !Array.isArray(messages) || messages.length === 0) {
            res.status(400).json({ error: "messages array is required" });
            return;
        }
        const last = messages[messages.length - 1];
        if (last.role !== "user") {
            res
                .status(400)
                .json({ error: "last message must be from the user" });
            return;
        }
        const question = last.content;
        const command = new RetrieveAndGenerateCommand({
            input: { text: question },
            retrieveAndGenerateConfiguration: {
                type: "KNOWLEDGE_BASE",
                knowledgeBaseConfiguration: {
                    knowledgeBaseId,
                    modelArn,
                },
            },
        });
        const response = await client.send(command);
        const answerText = response.output?.text ?? "(No answer returned)";
        const citations = response.citations ?? [];
        res.json({
            answer: answerText,
            citations,
        });
    }
    catch (err) {
        console.error("Error in /api/chat:", err);
        res.status(500).json({
            error: err?.message ?? "Unknown error",
        });
    }
});
const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
    console.log(`HR KB demo chat server running on http://localhost:${port} (region: ${region}, KB: ${knowledgeBaseId})`);
});
