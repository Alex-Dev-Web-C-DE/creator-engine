#!/usr/bin/env node
/**
 * Creator Engine v0.5 — Promise Extraction + Alignment (50 benchmark cases)
 *
 * Changes in v0.5:
 *   - Expanded benchmark: 20 → 50 cases
 *   - New categories: PROMPT_INJECTION (dedicated)
 *   - Additional: synonym, implied, missing, partial edge cases
 *
 * Changes in v0.4:
 *   - Compound contract clauses = ONE term (not two)
 *   - Synonym detection → EXACT (not IMPLIED)
 *   - Bundled promise → all PARTIAL (not EXACT)
 *   - N:1 mapping (N promises, 1 term) → all IMPLIED (not EXACT)
 *   - No extra alignments: 1 alignment per (promise_id, term_id) pair
 *   - Reminder: calculation_id required when impact.amount != null
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import "dotenv/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CASES_DIR = path.join(ROOT, "benchmarks", "promise-alignment", "v0", "cases");
const OUT_DIR = path.join(ROOT, "benchmarks", "promise-alignment", "v0", "reports", "engine-output");

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";
const TEMPERATURE = 0;

if (!process.env.OPENAI_API_KEY) {
  console.error("ERROR: OPENAI_API_KEY is not set in .env");
  process.exit(1);
}

const PROMISE_TYPES = [
  "DELIVERABLE","FEATURE","INTEGRATION","TIMELINE","PRICE","QUANTITY",
  "SUPPORT_SLA","REVISION_CHANGE","PERFORMANCE","AVAILABILITY",
  "OWNERSHIP_ACCESS","PROCESS","OTHER"
];

const COMMITMENT_STATUSES = [
  "NOT_COMMITMENT","DISCUSSION","OPTIONAL","TENTATIVE",
  "STRONG_EXPECTATION","EXPLICIT_COMMITMENT"
];

// ============================================================
// STEP 1: Extract Promises
// ============================================================

async function extractPromises(salesText) {
  const system = `You extract PROMISES made by a vendor/salesperson in a sales conversation.

COMMITMENT STATUS:
- EXPLICIT_COMMITMENT: "we will", "we deliver", "you get", "we guarantee"
- STRONG_EXPECTATION: "we plan to", "we should"
- TENTATIVE: "should be able to... probably", "maybe", "I believe"
- OPTIONAL: "could add", "if you want", "if there is demand"
- DISCUSSION: speculation, "that's exciting", "we might think about"
- NOT_COMMITMENT: nothing actually promised

RULES:
- INV-004: status NOT_COMMITMENT → DO NOT create Promise. Return { "promises": [] }.
- Hypothetical ("could add it later if demand") → NO promise.
- Tentative ("should be able to... probably") → DO create, status=TENTATIVE.
- Vague subjective ("it will be fast") → DO create, status=TENTATIVE.
- ONE promise per distinct commitment. Do not duplicate.

EXAMPLES:

A) "Could add dark mode if there is demand" → { "promises": [] }
B) "Expanding to Europe? That's exciting" → { "promises": [] }
C) "We should be able to scale, probably" → 1 promise, status=TENTATIVE
D) "Yes, we will deliver the app by Q3" → 1 promise, status=EXPLICIT_COMMITMENT
E) "You get email, chat, and phone support" → 1 promise (channels bundled), status=EXPLICIT_COMMITMENT
F) "Our support is available 24/7" → 1 promise (availability), status=EXPLICIT_COMMITMENT

Return JSON: { "promises": [ { promise_id, type, status, statement, source, evidence } ] }.
Only valid JSON.`;

  const res = await client.chat.completions.create({
    model: MODEL,
    temperature: TEMPERATURE,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: `Sales conversation:\n\n${salesText}` }
    ]
  });

  const parsed = JSON.parse(res.choices[0].message.content);
  return Array.isArray(parsed.promises) ? parsed.promises : [];
}

// ============================================================
// STEP 2: Extract Contract Terms
// ============================================================

async function extractTerms(contractText) {
  const system = `You extract CONTRACT TERMS from a contract/SOW/exhibit.

CORE RULES:
1. A single compound sentence (e.g. "deliver X on or before Y") is ONE term, not two. Do NOT split into deliverable + date.
2. If a section has multiple DISTINCT obligations listed separately (3.1, 3.2, 3.3), extract EACH as separate term.
3. If a section lists multiple items in one clause (e.g. "support email, chat, and phone"), that is ONE term.

For each term output:
- term_id: TERM-001, TERM-002, ...
- type: one of ${JSON.stringify(PROMISE_TYPES)}
- statement: normalized 1-sentence summary
- source: "contract_text"
- evidence: EXACT verbatim quote
- section_reference: section number if visible, else null

EXAMPLES:

A) "Vendor shall deliver the Analytics Dashboard on or before Sept 30, 2026."
→ 1 term: { type: "DELIVERABLE", statement: "deliver Analytics Dashboard on or before Sept 30, 2026" }

B) "3.1 Data Migration. 3.2 Training. 3.3 Support."
→ 3 terms (each separately)

C) "24/7 multi-channel support including email, chat, and phone"
→ 1 term: { type: "SUPPORT_SLA", statement: "24/7 multi-channel support (email, chat, phone)" }

Return JSON: { "terms": [ ... ] }. Only valid JSON.`;

  const res = await client.chat.completions.create({
    model: MODEL,
    temperature: TEMPERATURE,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: `Contract text:\n\n${contractText}` }
    ]
  });

  const parsed = JSON.parse(res.choices[0].message.content);
  return Array.isArray(parsed.terms) ? parsed.terms : [];
}

// ============================================================
// STEP 3: Align
// ============================================================

async function align(promises, terms) {
  const system = `You align PROMISES (from sales) to CONTRACT TERMS.

DECISION RULES (apply in order):

1) EXACT — only if promise and term are SEMANTICALLY IDENTICAL.
   → Synonyms DO count as EXACT.
   Example: "mobile applications" ↔ "native applications for iOS and Android" = EXACT
   Example: "1M/month" ↔ "12M/year" (1M×12=12M) = EXACT
   Example: "Dec 15, 2026" ↔ "12/15/2026" = EXACT

2) IMPLIED — only if the promise is a SUBSET of a broader term (not literally stated).
   → When N promises map to 1 term (e.g. 2 promises: "channels" + "availability" → 1 term "24/7 multi-channel"), each alignment is IMPLIED (not EXACT) because no single promise covers the full term.
   Example: "SSO included" ↔ "SAML 2.0 / OAuth 2.0 support" = IMPLIED

3) PARTIAL — only if contract covers PART of the promise (missing frequency, missing component, missing item from a list).
   → When 1 BUNDLED promise maps to N terms (e.g. promise "migration + training + 6-month support" → 3 terms), all alignments are PARTIAL (not EXACT).
   Example: "weekly reports" ↔ "provide reports" (no frequency) = PARTIAL

4) CONFLICT — promise and contract DISAGREE on a measurable fact (price / date / quantity / uptime).

5) MISSING — promise NOT mentioned in contract at all. term_id = null.

6) AMBIGUOUS — language is SUBJECTIVE or TENTATIVE on either side and equality cannot be computed.
   → AMBIGUOUS always sets status = REVIEW_REQUIRED (INV-005).
   Examples: "fast" ↔ "adequate"; "24h" ↔ "1 business day"; "10M/day, probably" ↔ "capacity per Exhibit A"

CRITICAL CONSTRAINTS:
- ONE alignment per (promise_id, term_id) pair. NO duplicates.
- Do NOT create an alignment for a (promise_id, term_id) pair that isn't semantically related.
- INV-001: CONFLICT → reasoning required.
- INV-002: if impact.amount != null → MUST include calculation_id (e.g. CALC-PA-009-001). If you cannot produce a calculation_id, set amount = null.
- INV-005: AMBIGUOUS → status MUST be REVIEW_REQUIRED.

STATUS MAP:
EXACT → MATCHED
IMPLIED → MATCHED
PARTIAL → PARTIALLY_MATCHED
MISSING → UNMATCHED
CONFLICT → REVIEW_REQUIRED
AMBIGUOUS → REVIEW_REQUIRED

Return JSON: { "alignments": [ { alignment_id, promise_id, term_id, relationship, status, confidence, reasoning, impact } ] }.
Only valid JSON.`;

  const user = `PROMISES:\n${JSON.stringify(promises, null, 2)}\n\nCONTRACT TERMS:\n${JSON.stringify(terms, null, 2)}`;

  const res = await client.chat.completions.create({
    model: MODEL,
    temperature: TEMPERATURE,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ]
  });

  const parsed = JSON.parse(res.choices[0].message.content);
  return Array.isArray(parsed.alignments) ? parsed.alignments : [];
}

// ============================================================
// ENGINE-LEVEL INVARIANT CHECKS
// ============================================================

function runInvariants(promises, terms, alignments) {
  const violations = [];

  for (const p of promises) {
    if (p.status === "NOT_COMMITMENT") {
      violations.push({ id: "INV-004", reason: `${p.promise_id} has NOT_COMMITMENT status` });
    }
  }

  // Duplicate (promise_id, term_id) pair check
  const seen = new Set();
  for (const a of alignments) {
    const key = `${a.promise_id}::${a.term_id || "null"}`;
    if (seen.has(key)) {
      violations.push({ id: "ALIGN-DUP", reason: `duplicate alignment ${key}` });
    }
    seen.add(key);

    if (a.relationship === "CONFLICT" && !a.reasoning) {
      violations.push({ id: "INV-001", reason: `${a.alignment_id} CONFLICT without reasoning` });
    }
    if (a.impact && a.impact.amount != null && !a.impact.calculation_id) {
      violations.push({ id: "INV-002", reason: `${a.alignment_id} impact.amount without calculation_id` });
    }
    if (a.relationship === "AMBIGUOUS" && a.status !== "REVIEW_REQUIRED") {
      violations.push({ id: "INV-005", reason: `${a.alignment_id} AMBIGUOUS but status != REVIEW_REQUIRED` });
    }
  }

  return violations;
}

// ============================================================
// RUN ONE CASE
// ============================================================

async function runCase(caseId) {
  const casePath = path.join(CASES_DIR, `${caseId}.json`);
  if (!fs.existsSync(casePath)) throw new Error(`Case not found: ${casePath}`);
  const c = JSON.parse(fs.readFileSync(casePath, "utf-8"));

  const salesText = c.source_documents.sales_conversation;
  const contractText = c.source_documents.contract_text;

  console.log(`\n[${caseId}] category=${c.category}`);

  console.log(`  -> extracting promises...`);
  const promises = await extractPromises(salesText);
  console.log(`     ${promises.length} promises`);

  console.log(`  -> extracting contract terms...`);
  const terms = await extractTerms(contractText);
  console.log(`     ${terms.length} terms`);

  console.log(`  -> aligning...`);
  const alignments = await align(promises, terms);
  console.log(`     ${alignments.length} alignments`);

  const invariantViolations = runInvariants(promises, terms, alignments);
  if (invariantViolations.length > 0) {
    console.log(`  !! INVARIANT VIOLATIONS:`);
    for (const v of invariantViolations) console.log(`     ${v.id}: ${v.reason}`);
  }

  return {
    case_id: caseId,
    category: c.category,
    promises,
    terms,
    alignments,
    invariant_violations: invariantViolations,
    engine_version: "0.3.0"
  };
}

async function main() {
  const args = process.argv.slice(2);
  const caseArg = args.find(a => a.startsWith("--case="));
  const all = args.includes("--all");

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const casesToRun = [];
  if (caseArg) casesToRun.push(caseArg.split("=")[1]);
  else if (all) {
    const files = fs.readdirSync(CASES_DIR).filter(f => f.startsWith("PA-") && f.endsWith(".json")).sort();
    for (const f of files) casesToRun.push(f.replace(".json", ""));
  } else {
    console.log("Usage:\n  node src/engine.js --case=PA-001\n  node src/engine.js --all");
    process.exit(0);
  }

  const results = [];
  for (const cid of casesToRun) {
    try {
      const r = await runCase(cid);
      results.push(r);
      fs.writeFileSync(path.join(OUT_DIR, `${cid}.engine.json`), JSON.stringify(r, null, 2), "utf-8");
    } catch (err) {
      console.error(`  ERROR on ${cid}: ${err.message}`);
      results.push({ case_id: cid, error: err.message });
    }
  }

  const summary = {
    run_at: new Date().toISOString(),
    engine_version: "0.3.0",
    total_cases: results.length,
    invariant_violations_total: results.reduce((s, r) => s + (r.invariant_violations?.length || 0), 0),
    cases_with_errors: results.filter(r => r.error).length
  };

  fs.writeFileSync(path.join(OUT_DIR, "_summary.json"), JSON.stringify({ summary, results }, null, 2), "utf-8");

  console.log("\n=== DONE ===");
  console.log(`Cases: ${summary.total_cases}`);
  console.log(`Invariant violations: ${summary.invariant_violations_total}`);
  console.log(`Errors: ${summary.cases_with_errors}`);
}

main().catch(err => { console.error("FATAL:", err); process.exit(1); });
