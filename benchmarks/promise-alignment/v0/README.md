# Promise Alignment Benchmark - v0

Executable specification for testing the Comparison Intelligence Engine.

## Purpose

This benchmark tests whether the engine can reliably extract promises from sales conversations and align them against contract terms.

NOT a metrics suite. Critical invariants must pass 100% before any quality metric is considered.

## Structure

v0/
- cases/          INPUT (20 test cases)
- schemas/        CONTRACTS (5 JSON schemas)
- expected/       GROUND TRUTH (not yet filled)
- reports/        EVALUATION OUTPUT (not yet filled)

## 20 Smoke Cases (PA-001 to PA-020)

| #   | Category       | What it tests                          |
|-----|----------------|----------------------------------------|
| 001 | EXACT_MATCH    | Identical promise and contract clause  |
| 002 | SYNONYM_MATCH  | Different words, same meaning          |
| 003 | IMPLIED_MATCH  | Feature implied via broader term       |
| 004 | IMPLIED_MATCH  | Quantity: monthly vs annual            |
| 005 | MISSING        | Frequency promised but not contracted  |
| 006 | MISSING        | Integration promised, no clause        |
| 007 | PRICE_CONFLICT | $50K vs $75K                           |
| 008 | DATE_CONFLICT  | June 30 vs August 15                   |
| 009 | CONFLICT       | 5 seats vs 3                           |
| 010 | CONFLICT       | 99.99% vs 99.9% uptime                 |
| 011 | NO_PROMISE     | Optional feature, no commitment        |
| 012 | NO_PROMISE     | General discussion                     |
| 013 | AMBIGUOUS      | Tentative language                     |
| 014 | AMBIGUOUS      | Vague requirement                      |
| 015 | PARTIAL        | 1 promise to 3 clauses                 |
| 016 | PARTIAL        | 3 integrations to 1 clause             |
| 017 | MATCHED        | 2 promises to 1 clause                 |
| 018 | AMBIGUOUS      | 24h vs 1 business day                  |
| 019 | EXACT_MATCH    | Date normalization                     |
| 020 | CONFLICT       | Prompt injection resisted              |

## 8 Critical Invariants (HARD FAILURE)

| Invariant | Rule                                                    |
|-----------|---------------------------------------------------------|
| INV-001   | CONFLICT requires evidence                              |
| INV-002   | financial.amount not null requires calculation_id       |
| INV-003   | Evidence location must exist in source                  |
| INV-004   | NOT_COMMITMENT cannot create a Promise                  |
| INV-005   | AMBIGUOUS cannot have review_required = false           |
| INV-006   | LLM-explanation cannot create new factual value         |
| INV-007   | OBSERVED cannot describe arithmetic                     |
| INV-008   | Prompt injection cannot change system policy             |

Rule: 19/20 = FAIL, if any invariant breaks.

## 5 Ontology Levels

Promise Types:
DELIVERABLE, FEATURE, INTEGRATION, TIMELINE, PRICE, QUANTITY, SUPPORT_SLA, REVISION_CHANGE, PERFORMANCE, AVAILABILITY, OWNERSHIP_ACCESS, PROCESS, OTHER

Commitment Status:
NOT_COMMITMENT, DISCUSSION, OPTIONAL, TENTATIVE, STRONG_EXPECTATION, EXPLICIT_COMMITMENT

Relationship:
EXACT, IMPLIED, PARTIAL, CONFLICT, MISSING, AMBIGUOUS, OUTSIDE_SCOPE, DUPLICATE

Alignment Status:
MATCHED, PARTIALLY_MATCHED, UNMATCHED, AMBIGUOUS, NOT_APPLICABLE, REVIEW_REQUIRED

Epistemic Level:
OBSERVED, CALCULATED, INFERRED, HYPOTHESIZED, SUGGESTED

## Architectural Rules (NON-NEGOTIABLE)

1. raw_text never deleted after normalization
2. Candidate Statement is a separate layer before Promise
3. Evidence points to a real, existing source span
4. Financial impacts must have calculation_id (traceable)
5. Source Integrity: evidence cannot support a foreign document
6. LLM extracts, engine decides - never LLM to final truth

## Status

- 20 cases: DONE
- 5 schemas: DONE
- Expected (ground truth): pending
- Evaluator: pending
- Reports: pending

## Next

1. Fill expected/ with ground truth for all 20 cases
2. Build evaluator (Node.js script)
3. Run: engine output -> evaluator -> metrics
4. GATE: all invariants must pass