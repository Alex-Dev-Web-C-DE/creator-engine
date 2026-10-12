/**
 * Pure tool functions — business logic only, no MCP dependency.
 * Each function is registered as an MCP tool in index.ts.
 *
 * This separation makes tools easy to unit test without MCP infrastructure.
 */

const WORKER_URL = process.env.CREATOR_ENGINE_URL || "https://creator-engine.boring-saas-infra.workers.dev";

export interface ExtractPromisesResult {
  [key: string]: unknown;
  status: string;
  data: {
    promises: Array<Record<string, unknown>>;
    contract_terms: Array<Record<string, unknown>>;
    alignments: Array<Record<string, unknown>>;
  };
}

export async function extractPromises(
  salesText: string,
  contractText: string
): Promise<ExtractPromisesResult> {
  const res = await fetch(`${WORKER_URL}/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sales_text: salesText, contract_text: contractText }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Worker error (${res.status}): ${errText}`);
  }

  const json = (await res.json()) as ExtractPromisesResult;
  return json;
}
