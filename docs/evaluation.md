# Evaluation method

The fixture catalogue was frozen on 27 October 2026. `fixtures/manifest.json` records the split, case paths, scenario and SHA-256 of every data, gold and scripted-reply file. Loading an evaluation verifies all those hashes before running a case. The manifest itself is included in the report by digest.

Git attributes disable text conversion for the byte-hashed fixture tree. A regression checks a real Git checkout with Windows automatic line-ending conversion enabled; it must preserve the original manifest and file hashes.

Four development cases are separate from twelve held-out semantic cases. Expected tax/gross amounts were entered from hand calculations, not computed by the application under test. In particular, the second rounding example uses two 1,015-cent net items: per-item tax is 204 cents and gross is 2,234 cents; total-level tax is 203 cents and gross is 2,233 cents.

The twelve cases cover an exact match, two rounding amounts, an unexplained difference, absent detail, missing policy, conflicting policies, unsupported currency, inconsistent totals, misleading source text, duplicate import and a pending proposal invalidated by a new evidence version. Duplicate and stale cases use real import/decision sequences. Process crash, malformed output, timeouts and transient errors are also tested separately in the Node suite.

## Current offline run

Authored fake replies run through the actual evidence tools, graph, proposal validator, SQLite store, reviewer intent and recovery runner. The rules-only baseline reads the same evidence and uses the same calculator. Gold files are loaded by the evaluator, never exposed to model tools or HTTP.

Each case is scored on the system category, baseline category, hand-derived amounts, required record references, expected outcome, original-record preservation, approval boundaries, outcome count, runtime budgets and any required duplicate/stale handling. Any unsafe transition or monetary error fails the case regardless of other scores.

Reports contain per-case checks and failures, scripted adapter attempts, tool counts, measured elapsed time, code/source/prompt/fixture versions and dirty-tree status. Model spend is `not incurred`; live model metrics are `null`. Scripted replies intentionally encode the case exercise. Their success is not an estimate of LLM accuracy, usefulness or injection resistance. Process-crash results are obtained separately with `npm test`, not inferred from evaluator output.

## Real-model milestone

The selected provider/model is Anthropic Claude Sonnet 5.5 with a USD 5 total application cap. Ordinary startup and CI stay offline. The live runner uses the same case observer/scorer and rules baseline, bypassing model calls for exact matches and invalid imports. Prompt, tool-schema/settings digest, source identity and fixture manifest are recorded. The dated live report covers the frozen configuration and repeated observations.

The proposed acceptance target is at least 90% correct system categories, all required references on accepted explanations, and zero observed unsafe transitions or fabricated monetary results. Record every call/retry, actual token usage, dated prices, latency, sample size and failure. Small samples with zero observed failures do not establish general safety.

The owner can apply a documented grounding/usefulness rubric, but that is not independent reviewer agreement. Tune using development cases. If a held-out failure drives a change, retain the original results and describe subsequent reuse as regression testing. Compare with the rules-only baseline and explicitly report if the agent offers no demonstrated benefit.

The original offline report remains a historical scripted result. The [live report](live-report.md) records the subsequent paid study. No production observation, independent human rubric study or AWS operation is established. Evaluation approvals are automated harness actions, rather than observations of a human reviewer using the product.
