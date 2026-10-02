#!/usr/bin/env node
/**
 * Engine Output Evaluator
 * Compares engine output (reports/engine-output/*.engine.json) to ground truth (expected/all.json).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_OUT_DIR = path.join(__dirname, "reports", "engine-output");
const EXPECTED_FILE = path.join(__dirname, "expected", "all.json");
const REPORT_PATH = path.join(__dirname, "reports", "engine-evaluation.json");

function loadJSON(p) { return JSON.parse(fs.readFileSync(p, "utf-8")); }

function getEngineRelationships(engineOut) {
  const a = engineOut.alignments || [];
  return a.map(x => x.relationship).sort();
}
function getEngineStatuses(engineOut) {
  const a = engineOut.alignments || [];
  return a.map(x => x.status).sort();
}

function compare(caseId, gt, engineOut) {
  const result = {
    case_id: caseId,
    category: gt.category,
    expected_relationships: gt.expected_relationships || [],
    actual_relationships: getEngineRelationships(engineOut),
    expected_statuses: gt.expected_statuses || [],
    actual_statuses: getEngineStatuses(engineOut),
    expected_promises_count: gt.expected_promises_count ?? null,
    actual_promises_count: (engineOut.promises || []).length,
    engine_invariant_violations: engineOut.invariant_violations || [],
    checks: {}
  };

  const er = JSON.stringify([...result.expected_relationships].sort());
  const ar = JSON.stringify([...result.actual_relationships].sort());
  result.checks.relationships_match = (er === ar);

  const es = JSON.stringify([...result.expected_statuses].sort());
  const as = JSON.stringify([...result.actual_statuses].sort());
  result.checks.statuses_match = (es === as);

  if (result.expected_promises_count !== null) {
    result.checks.promises_count_match =
      result.expected_promises_count === result.actual_promises_count;
  } else {
    result.checks.promises_count_match = true;
  }

  result.checks.no_engine_invariant_violations =
    result.engine_invariant_violations.length === 0;

  result.passed =
    result.checks.relationships_match &&
    result.checks.statuses_match &&
    result.checks.promises_count_match &&
    result.checks.no_engine_invariant_violations;

  return result;
}

function run() {
  console.log("=== Engine Output Evaluation ===\n");

  if (!fs.existsSync(ENGINE_OUT_DIR)) {
    console.error("No engine output dir:", ENGINE_OUT_DIR);
    process.exit(1);
  }

  const expected = loadJSON(EXPECTED_FILE);
  const files = fs.readdirSync(ENGINE_OUT_DIR)
    .filter(f => f.startsWith("PA-") && f.endsWith(".engine.json"))
    .sort();

  console.log(`Engine outputs found: ${files.length}`);
  console.log(`Ground truth entries: ${expected.ground_truth.length}\n`);

  const results = [];
  let passed = 0;
  let failed = 0;

  for (const f of files) {
    const caseId = f.replace(".engine.json", "");
    const gt = expected.ground_truth.find(g => g.case_id === caseId);
    if (!gt) {
      console.log(`[SKIP] ${caseId} - no ground truth`);
      continue;
    }
    const engineOut = loadJSON(path.join(ENGINE_OUT_DIR, f));
    const r = compare(caseId, gt, engineOut);
    results.push(r);
    if (r.passed) passed++; else failed++;

    const mark = r.passed ? "PASS" : "FAIL";
    console.log(`[${mark}] ${caseId}  ${gt.category.padEnd(18)} expR=${JSON.stringify(gt.expected_relationships)} actR=${JSON.stringify(r.actual_relationships)}`);
    if (!r.passed) {
      console.log(`        checks: rel=${r.checks.relationships_match} stat=${r.checks.statuses_match} cnt=${r.checks.promises_count_match} inv=${r.checks.no_engine_invariant_violations}`);
    }
  }

  const summary = {
    benchmark: "promise-alignment-v0-engine-eval",
    run_at: new Date().toISOString(),
    total: results.length,
    passed,
    failed,
    accuracy: results.length ? Number((passed / results.length).toFixed(3)) : 0
  };

  const report = { summary, results };
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf-8");

  console.log("\n=== SUMMARY ===");
  console.log(`Passed: ${passed}/${results.length}`);
  console.log(`Failed: ${failed}`);
  console.log(`Accuracy: ${(summary.accuracy * 100).toFixed(1)}%`);
  console.log(`Report: ${REPORT_PATH}`);
}

run();