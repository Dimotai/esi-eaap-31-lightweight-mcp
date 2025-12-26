import { BedrockAgentClient, StartIngestionJobCommand } from "@aws-sdk/client-bedrock-agent";

const client = new BedrockAgentClient({
  region: process.env.AWS_REGION || "us-east-1",
});

export const handler = async (event) => {
  const knowledgeBaseId = process.env.HR_KB_ID;
  const dataSourceId = process.env.HR_KB_DATASOURCE_ID;

  if (!knowledgeBaseId || !dataSourceId) {
    console.error("Missing env vars HR_KB_ID or HR_KB_DATASOURCE_ID");
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Missing knowledge base configuration",
      }),
    };
  }

  console.log("Starting ingestion job for KB:", knowledgeBaseId, "data source:", dataSourceId);

  try {
    const response = await client.send(
      new StartIngestionJobCommand({
        knowledgeBaseId,
        dataSourceId,
      })
    );

    const job = response.ingestionJob || {};
    console.log("Ingestion job started:", JSON.stringify(job, null, 2));

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Ingestion job started",
        ingestionJobId: job.ingestionJobId,
        status: job.status,
      }),
    };
  } catch (error) {
    console.error("Error starting ingestion job:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Failed to start ingestion job",
        error: error.message,
      }),
    };
  }
};
