#!/usr/bin/env node
/**
 * Creator Engine MCP Server
 * Wraps the Creator Engine Worker as an MCP tool.
 *
 * Endpoint: https://creator-engine.boring-saas-infra.workers.dev
 * Tool: extract_promises
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const WORKER_URL = process.env.CREATOR_ENGINE_URL || 'https://creator-engine.boring-saas-infra.workers.dev';

const server = new Server(
  {
    name: 'creator-engine',
    version: '0.5.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// === List tools ===
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'extract_promises',
      description: 'Extract promises from a sales conversation and align them against contract terms. Returns promises, contract_terms, and alignments (EXACT, IMPLIED, PARTIAL, MISSING, CONFLICT, AMBIGUOUS).',
      inputSchema: {
        type: 'object',
        properties: {
          sales_text: {
            type: 'string',
            description: 'Sales conversation text (vendor promises, commitments)',
          },
          contract_text: {
            type: 'string',
            description: 'Contract text (terms, clauses)',
          },
        },
        required: ['sales_text', 'contract_text'],
      },
    },
  ],
}));

// === Call tool ===
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== 'extract_promises') {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  const { sales_text, contract_text } = request.params.arguments;

  if (!sales_text || !contract_text) {
    throw new Error('Both sales_text and contract_text are required');
  }

  const res = await fetch(`${WORKER_URL}/extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sales_text, contract_text }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Worker error (${res.status}): ${err}`);
  }

  const data = await res.json();

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
});

// === Start ===
const transport = new StdioServerTransport();
await server.connect(transport);
console.error('Creator Engine MCP server running on stdio');
