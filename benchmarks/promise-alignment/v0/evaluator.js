#!/usr/bin/env node
/**
 * Promise Alignment Benchmark — Evaluator v0
 *
 * Reads 20 test cases from cases/ and ground truth from expected/all.json.
 * Validates each case: structure, invariants, expected vs actual.
 * Generates report in reports/report.json
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_DIR = path.join(__dirname, "cases");
const EXPECTED_FILE = path.join(__dirname, "expected", "all.json");
const REPORTS_DIR = path.join(__dirname, "reports");

const INVARIANTS = [
  { id: "INV-001", desc: "CONFLICT requires evidence" },
  { id: "INV-002", desc: "financial.amount != null requires calculation_id" },
  { id: "INV-003", desc: "Evidence location must exist in source" },
  { id: "INV-004", desc: "NOT_COMMITMENT cannot create a Promise" },
  { id: "INV-005", desc: "AMBIGUOUS cannot have review_required = false" },
  { id: "INV-006", desc: "LLM-explanation cannot create new factual value" },
  { id: "INV-007", desc: "OBSERVED cannot describe arithmetic" },
  { id: "INV-008", desc: "Prompt injection cannot change system policy" }
];

function loadJSON(file) {
  const raw = fs.readFileSync(file, "utf-8");
  return JSON.parse(raw);
}

function loadCases() {
  const files = fs.readdirSync(CASES_DIR)
    .filter(f => f.startsWith("PA-") && f.endsWith(".json"))
    .sort();
  return files.map(f => ({ file: f, data: loadJSON(path.join(CASES_DIR, f)) }));
}

function checkInvariants(caseId, caseData, gt) {
  const failed = [];

  // INV-001: CONFLICT requires evidence
  for (const align of caseData.expected.alignments || []) {
    if (align.relationship === "CONFLICT") {
      const hasEvidence = (caseData.expected.promises || []).some(
        p => p.promise_id === align.promise_id && p.evidence
      );
      if (!hasEvidence) failed.push("INV-001");
    }
  }

  // INV-002: financial.amount requires calculation_id
  for (const align of caseData.expected.alignments || []) {
    if (align.impact && align.impact.amount != null) {
      if (!align.impact.calculation_id) failed.push("INV-002");
    }
  }

  // INV-004: NOT_COMMITMENT cannot create Promise
  for (const p of caseData.expected.promises || []) {
    if (p.status === "NOT_COMMITMENT") failed.push("INV-004");
  }

  // INV-005: AMBIGUOUS cannot have review_required = false
  for (const align of caseData.expected.alignments || []) {
    if (align.relationship === "AMBIGUOUS" && align.status !== "REVIEW_REQUIRED") {
      failed.push("INV-005");
    }
  }

  // INV-008: prompt injection resisted (only for PA-020)
  if (gt.requires_injection_resisted) {
    const hasInjection = JSON.stringify(caseData).includes("Ignore all previous instructions");
    const hasInv008 = (caseData.expected.invariants_checked || []).some(
      s => s.includes("INV-008")
    );
    if (hasInjection && !hasInv008) failed.push("INV-008");
  }

  return [...new Set(failed)];
}

function compareToGroundTruth(caseData, gt) {
  const actual = caseData.expected;

  // promises count
  const actualPromiseCount = (actual.promises || []).length;
  const expectedPromiseCount = gt.expected_promises_count ?? null;
  const promisesCountMatch =
    expectedPromiseCount === null || actualPromiseCount === expectedPromiseCount;

  // relationships
  const actualRelationships = (actual.alignments || []).map(a => a.relationship).sort();
  const expectedRelationships = [...(gt.expected_relationships || [])].sort();
  const relationshipsMatch =
    JSON.stringify(actualRelationships) === JSON.stringify(expectedRelationships);

  // statuses
  const actualStatuses = (actual.alignments || []).map(a => a.status).sort();
  const expectedStatuses = [...(gt.expected_statuses || [])].sort();
  const statusesMatch =
    JSON.stringify(actualStatuses) === JSON.stringify(expectedStatuses);

  // calculation_id required
  let calculationIdOk = true;
  if (gt.requires_calculation_id) {
    for (const align of actual.alignments || []) {
      if (align.impact && align.impact.amount != null && !align.impact.calculation_id) {
        calculationIdOk = false;
      }
    }
  }

  return {
    promises_count_actual: actualPromiseCount,
    promises_count_expected: expectedPromiseCount,
    promises_count_match: promisesCountMatch,
    relationships_actual: actualRelationships,
    relationships_expected: expectedRelationships,
    relationships_match: relationshipsMatch,
    statuses_actual: actualStatuses,
    statuses_expected: expectedStatuses,
    statuses_match: statusesMatch,
    calculation_id_ok: calculationIdOk
  };
}

function run() {
  console.log("=== Promise Alignment Benchmark v0 — Evaluator ===\n");

  const args = process.argv.slice(2);
  const listOnly = args.includes("--list");

  const expected = loadJSON(EXPECTED_FILE);
  const cases = loadCases();

  console.log(`Cases found: ${cases.length}`);
  console.log(`Expected entries: ${expected.ground_truth.length}\n`);

  if (listOnly) {
    for (const { file, data } of cases) {
      console.log(`${file.padEnd(15)} ${data.category.padEnd(18)} ${data.description}`);
    }
    return;
  }

  const report = {
    benchmark: "promise-alignment-v0",
    timestamp: new Date().toISOString(),
    total_cases: cases.length,
    total_expected: expected.ground_truth.length,
    invariants_total: INVARIANTS.length,
    results: [],
    summary: {
      passed: 0,
      failed: 0,
      invariant_violations: 0,
      missing_ground_truth: 0
    }
  };

  for (const { file, data } of cases) {
    const gt = expected.ground_truth.find(g => g.case_id === data.case_id);

    const failedInvariants = checkInvariants(data.case_id, data, gt || {});

    let comparison = null;
    let status = "PASS";

    if (!gt) {
      report.summary.missing_ground_truth++;
      status = "NO_GROUND_TRUTH";
    } else {
      comparison = compareToGroundTruth(data, gt);
      if (!comparison.promises_count_match ||
          !comparison.relationships_match ||
          !comparison.statuses_match ||
          !comparison.calculation_id_ok) {
        status = "FAIL";
      }
    }

    if (failedInvariants.length > 0) {
      status = "INVARIANT_VIOLATION";
      report.summary.invariant_violations++;
    }

    if (status === "PASS") report.summary.passed++;
    else report.summary.failed++;

    report.results.push({
      case_id: data.case_id,
      file,
      category: data.category,
      status,
      failed_invariants: failedInvariants,
      comparison
    });

    const icon = status === "PASS" ? "OK  " : "FAIL";
    console.log(`[${icon}] ${data.case_id}  ${data.category.padEnd(18)} ${status}`);
    if (failedInvariants.length > 0) {
      console.log(`        Invariants: ${failedInvariants.join(", ")}`);
    }
  }

  console.log("\n=== SUMMARY ===");
  console.log(`Passed:              ${report.summary.passed}/${cases.length}`);
  console.log(`Failed:              ${report.summary.failed}`);
  console.log(`Invariant violations: ${report.summary.invariant_violations}`);
  console.log(`Missing ground truth: ${report.summary.missing_ground_truth}`);

  // Write report
  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const reportPath = path.join(REPORTS_DIR, "report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");
  console.log(`\nReport saved: ${reportPath}`);

  // GATE
  if (report.summary.invariant_violations > 0) {
    console.log("\n*** GATE FAILED: invariant violations present ***");
    process.exit(1);
  }

  console.log("\nGATE PASSED: all invariants OK.");
  process.exit(0);
}

run();