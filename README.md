# ESI HR Knowledge Base MCP Server

This repository contains the MCP server that connects ESI's HR knowledge base (AWS Bedrock Knowledge Base backed by Aurora pgvector) to MCP-compatible clients (e.g. ChatGPT / MCP Inspector / internal agents).

The server exposes a single tool, `retrieve_hr_policy`, which lets HR agents and internal tools query the HR knowledge base and receive ranked chunks plus metadata (S3 path, page number, scores, etc.).

## High-Level Architecture

### Data Pipeline

HR documents (handbook, PTO/leave, benefits, Unanet guides, state notices, etc.) are stored in S3 under:

```
s3://esi-hr-docs/...
```

An AWS Bedrock Knowledge Base indexes this bucket:

- **Name:** `esi-hr-kb-dev`
- **Knowledge Base ID:** `OLRJAOAVCZ`
- **Region:** `us-east-1`
- **Embedding model:** Titan Text Embeddings v2 (or similar)
- **Vector store:** Amazon Aurora PostgreSQL (pgvector)

A scheduled Lambda + EventBridge job (`hr-kb-scheduled-sync`) runs `StartIngestionJob` for `OLRJAOAVCZ` and its S3 data source (`XY5AQACOZ8`) to keep the KB in sync with S3.

### MCP Integration

- This repo hosts a Node.js / TypeScript MCP server
- The server uses the Bedrock Agent Runtime client to call `Retrieve` against the HR knowledge base
- MCP-compatible clients call the `retrieve_hr_policy` tool and receive:
  - Retrieved content chunks
  - S3 source locations
  - Relevance scores
  - Misc. Bedrock KB metadata

## Project Structure

```
esi-hr-mcp/
├─ src/
│  └─ index.ts          # MCP server + retrieve_hr_policy implementation
├─ build/               # Compiled JS output from npm run build
├─ .env                 # Optional local env vars (NOT committed)
├─ package.json
├─ tsconfig.json
└─ README.md            # This file
```

## Prerequisites

- **Node.js 18+** and npm
- **AWS CLI** configured with a profile that can access:
  - The Bedrock Knowledge Base `OLRJAOAVCZ`
  - Bedrock Agent Runtime in `us-east-1`
- Network access to AWS Bedrock endpoints from wherever this MCP server runs

The MCP server uses standard AWS SDK credential resolution (environment variables, config/credentials files, SSO profiles, etc.). It does not expose an HTTP server; it speaks MCP over stdio.

## Environment Variables

The server expects these environment variables at runtime:

- `AWS_REGION` – AWS region where the KB lives (e.g., `us-east-1`)
- `AWS_PROFILE` – (optional) AWS CLI profile to use for credentials
- `HR_KB_ID` – Bedrock Knowledge Base ID (e.g., `OLRJAOAVCZ`)

### Option 1: Via Shell / Process Environment (Recommended for Local Dev)

**PowerShell example:**

```powershell
$env:AWS_PROFILE = "AdministratorAccess-285397596138"
$env:AWS_REGION  = "us-east-1"
$env:HR_KB_ID    = "OLRJAOAVCZ"

npm start
```

### Option 2: Via MCP Inspector Configuration

In Inspector's connection configuration (Environment Variables section), set:

- `AWS_PROFILE` = `AdministratorAccess-285397596138`
- `AWS_REGION` = `us-east-1`
- `HR_KB_ID` = `OLRJAOAVCZ`

> **Note:** There may be a `.env` file in the repo for convenience, but the current implementation does not automatically load it at runtime. If you want to re-enable `.env` loading, you can safely re-introduce `dotenv` in `src/index.ts` as long as it does not print anything to stdout (which would conflict with MCP's JSON-over-stdio protocol).

## Install, Build & Run

### 1. Install Dependencies

From the repo root:

```bash
npm install
```

### 2. Build TypeScript

```bash
npm run build
```

This compiles `src/index.ts` to `build/index.js`.

### 3. Run the MCP Server (Standalone)

Set the environment variables (as above), then:

```bash
npm start
```

You should see log lines similar to:

```
esi-hr-kb-server MCP up on stdio
Starting esi-hr-kb-server with KB ID=OLRJAOAVCZ, region=us-east-1, profile=AdministratorAccess-285397596138
```

At this point, the process is waiting for an MCP client over stdio. It does not bind to an HTTP port (there is no `http://localhost:3000`).

## Using with MCP Inspector

You can use MCP Inspector to debug and explore the tool.

### Let Inspector Launch the Server

1. **Build the project:**

   ```bash
   npm run build
   ```

2. **Launch Inspector:**

   ```bash
   npx @modelcontextprotocol/inspector
   ```

3. **In the Inspector UI, configure a new connection:**

   - **Transport Type:** STDIO
   - **Command:** `node`
   - **Arguments:** `build/index.js`
   - **Working directory:** Path to this repo on your machine  
     (e.g., `C:\Users\<you>\Desktop\Career\ESI\EAAP - 31\esi-hr-mcp`)
   - **Environment variables:**
     - `AWS_PROFILE` = `AdministratorAccess-285397596138`
     - `AWS_REGION` = `us-east-1`
     - `HR_KB_ID` = `OLRJAOAVCZ`

4. **Click "Connect"**

Inspector should show:
- A successful connection
- Available tools, including `retrieve_hr_policy`

### Testing the Tool

In the Tools tab, select `retrieve_hr_policy` and run a test query:

**Example query:**

```
How do I submit a leave request in Unanet?
```

**Example JSON input:**

```json
{
  "query": "How do I submit a leave request in Unanet?",
  "topK": 5,
  "scoreThreshold": 0.3
}
```

You should see a JSON response with fields like:

- `query`
- `hitCount`
- `results[]` (one per ranked chunk)

Each result includes:
- `rank` – 1-based rank
- `score` – similarity score from Bedrock
- `text` – snippet of HR content
- `location.s3Location.uri` – S3 path of the source document
- `metadata` – includes page number, data source ID, etc.

Clients (ChatGPT, internal apps) can then generate a friendly answer and show links or citations using this information.

## Tool: `retrieve_hr_policy`

### Purpose

Query the ESI HR Bedrock Knowledge Base for HR policies, procedures, and workflows (Unanet, PTO, benefits, etc.), and return raw retrieved chunks with metadata and scores. Downstream clients can use these to generate human-friendly answers and citations.

### Inputs

The MCP schema is defined in `src/index.ts`, but logically the tool expects:

- **`query`** (string, required)  
  Natural language question (e.g., "How do I submit a leave request in Unanet?")

- **`topK`** (number, optional)  
  Maximum number of chunks to return. Default is typically 5 if not provided.

- **`scoreThreshold`** (number, optional)  
  Minimum similarity score. Chunks with scores below this value may be filtered out or flagged as low-confidence.

### Output Shape

A typical response from the tool looks like:

- `query` – echoed user query
- `hitCount` – number of retrieved chunks
- `results[]` – list of ranked results; each contains:
  - `rank` – rank order (1 is highest)
  - `score` – relevance score from Bedrock
  - `text` – extracted text chunk from the HR document
  - `location` – where the text came from (S3 URI, etc.)
  - `metadata` – additional keys such as:
    - `x-amz-bedrock-kb-source-uri`
    - `x-amz-bedrock-kb-document-page-number`
    - `x-amz-bedrock-kb-data-source-id`

Clients can use `location` and `metadata` to provide "View source" links and document citations.

## Maintaining the Knowledge Base (Infra Notes)

These components are outside this repo but are important context for developers.

### S3 and HR Documents

- **Bucket:** `esi-hr-docs`
- **Folder structure (examples):**
  - `handbook/`
  - `benefits/`
  - `leave-and-pto/`
  - `systems-guides/`
  - `state-notices/`
  - `timekeeping/`
  - `travel-and-expense/`

New or updated documents should be uploaded into the correct subfolder in `esi-hr-docs`.

### Bedrock Knowledge Base

- **Name:** `esi-hr-kb-dev`
- **ID:** `OLRJAOAVCZ`
- **Region:** `us-east-1`
- **Data source:** S3 (ID `XY5AQACOZ8`) pointing at `s3://esi-hr-docs/`
- **Embedding model:** Titan Text Embeddings v2 (or equivalent)
- **Vector store:** Aurora PostgreSQL with pgvector

### Sync and Refresh Options

The Knowledge Base needs ingest/sync jobs to incorporate new or changed docs.

#### Manual Sync

Use the AWS console: Bedrock → Knowledge Bases → `esi-hr-kb-dev` → Data source → "Sync"

#### Automated Sync (Implemented)

- **Lambda function:** `hr-kb-scheduled-sync`
- **Environment variables:**
  - `HR_KB_ID` = `OLRJAOAVCZ`
  - `HR_KB_DATASOURCE_ID` = `XY5AQACOZ8`
  - `AWS_REGION` = `us-east-1`
- **Behavior:**
  - Calls `StartIngestionJob` for the HR KB and data source
  - Logs ingestion job ID, status, and basic statistics
- **EventBridge schedule:**
  - Rule targeting `hr-kb-scheduled-sync` Lambda
  - Schedule expression such as `rate(1 day)` (can be adjusted as needed)

New or updated documents in `s3://esi-hr-docs/...` will be picked up and indexed after the next successful ingestion job completes.

## Development Notes and Future Work

### TypeScript and Build

- `tsconfig.json` is configured with:
  - `target`: `"ES2020"`
  - `module`: `"Node16"`
  - `moduleResolution`: `"Node16"`
  - `strict`: `true`
- `npm run build` compiles TypeScript to `build/index.js`

### Logging

**MCP server logs:**
- Startup info (KB ID, region, AWS profile)
- Errors from Bedrock Agent Runtime calls

**Lambda (`hr-kb-scheduled-sync`) logs:**
- Ingestion-job start events
- Ingestion job ID and initial status

### Possible Future Enhancements

- Add a second tool, e.g., `answer_hr_question`, that:
  - Uses `RetrieveAndGenerate` instead of `Retrieve`
  - Returns a composed natural-language answer plus citations, instead of just raw chunks
- Add simple re-ranking / filtering rules inside `retrieve_hr_policy`, such as:
  - Prefer `leave-and-pto/` or `systems-guides/` S3 prefixes for Unanet or leave-related queries
- Add automated tests (Jest/Vitest) to:
  - Validate the MCP tool schema
  - Mock Bedrock Agent Runtime and ensure payloads and result shapes are correct
- Add a "health check"/ping tool to make operational monitoring easier

## Ownership / Contact

- **Primary owner:** EAAP / AI Platform team
- **Primary consumers:** HR support agents and internal tools that need structured access to ESI HR content through AWS Bedrock and MCP

If any of the following change, this README and related runbooks should be updated:
- Knowledge base name/ID or region
- S3 bucket or folder structure
- MCP tool names or request/response schemas
- Sync strategy (manual vs scheduled) or Lambda/EventBridge wiring
