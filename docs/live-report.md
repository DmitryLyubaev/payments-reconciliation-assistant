# Claude evaluation report

Date: 27 October 2026. Provider: Anthropic. Model: `claude-sonnet-5-5`. Synthetic AUD records only.

The live Claude adapter completed twelve frozen semantic cases three times through the real evidence tools, exact proposal validator, persisted LangGraph, automated reviewer harness and outcome transaction. The prompt and request settings/tool-schema digest were frozen before these observations.

| Check                                                   |               Observed result |
| ------------------------------------------------------- | ----------------------------: |
| Case runs passing all contract checks                   |                      36 of 36 |
| Correct validated system categories                     |                      36 of 36 |
| Correct model proposal categories                       | 30 of 30 model investigations |
| Exact-match/import-rejection bypasses                   |        6, with no model calls |
| Rules-only baseline matching gold                       |                      36 of 36 |
| Accepted explanations with complete required references |                      12 of 12 |
| Source-preserving runs                                  |                      36 of 36 |
| Stale approvals refused                                 |                        3 of 3 |
| Observed unsafe transitions / accepted monetary errors  |                         0 / 0 |
| Provider calls / evidence-calculation tools             |                     108 / 183 |
| Reported input / output tokens                          |              273,056 / 34,254 |
| Study token charge                                      |                  USD 0.888652 |
| Development plus study measured token charges           |                  USD 0.921650 |
| Retained reservation without a usage receipt            |                  USD 2.040960 |
| Total measured charges plus retained reservation        |                  USD 2.962610 |
| Authorized application cap                              |                         USD 5 |
| Entire study elapsed time                               |                 384.9 seconds |
| Median / p95 case time for 30 model investigations      |           11.6 / 29.6 seconds |

Charges use the provider's reported usage at the dated standard prices of USD 2 per million input tokens and USD 10 per million output tokens. Caching and server-side paid tools were not enabled. Case times include model calls, local tools, SQLite and workflow handling; they are not isolated API latency or service guarantees. [Official model specifications and prices](https://platform.claude.com/docs/en/models/sonnet-5-5/overview).

The [reviewed JSON summary](results/live-2026-10-27.json) retains per-case outcomes, checks, references and explanations, plus model/prompt/request/source/manifest identities. It records code `dd76b84` and a dirty-tree flag because documentation was being prepared during the run; the source digest identifies the measured implementation. The original offline JSON/report remains unchanged as historical evidence.

## Development failure and correction

Development used the rounding fixture. Its first generation request was rejected, without a valid usage receipt. The free token-counting endpoint reproduced a strict-schema error: the integer `minimum` property was unsupported. A failing transport-boundary regression captured that condition. The wire schema now omits the unsupported constraint while application-side validation still requires positive evidence versions. The free request check then succeeded, and the development workflow passed with four provider calls, seven tools and USD 0.032998 in reported token charges. [Token counting documentation](https://platform.claude.com/docs/en/build-with-claude/token-counting).

The rejected request's full maximum reservation remains in the budget ledger. It is a conservative hold, not a claim that the provider charged USD 2.040960. Since its usage was not captured, the exact aggregate invoice charge is not asserted. The study itself has valid usage for every one of its 108 calls and its USD 0.888652 token charge is independently calculable from the totals above.

The retained reservation leaves USD 2.037390 of ledger headroom, slightly less than a new request's full conservative maximum of USD 2.040960. Consequently this particular ledger now stops further paid calls even though measured token charges are below USD 1. It was not reset to continue. Existing saved proposals can still be reviewed; further paid work needs billing reconciliation or a separately authorized budget change.

## What was observed

All 30 actual model proposals matched the expected category and recorded difference. The six bypass runs performed no inference. The model left missing detail, missing policy, conflicting policies and unexplained differences unresolved. Misleading imported text did not change the expected category in its three observations. New source versions invalidated all three stale decisions. These are observations on this sample, rather than general injection-resistance or financial-safety guarantees.

Selected first-pass explanations for rounding, missing detail, conflicting policies, contradictory totals, misleading notes and stale evidence were inspected by the implementation agent against source facts. For example, the rounding explanation identified identical 1,005-cent items, POS tax/gross of 202/2,212 cents and accounting tax/gross of 201/2,211 cents under their respective policies. This inspection is not independent human reviewer agreement, and structural validation cannot establish that every possible narrative sentence will be grounded.

The rules-only baseline also matched all 36 categories. This study demonstrates a real model using constrained tools and producing evidence-based explanations inside a reviewed workflow. It does not demonstrate a category-accuracy advantage, productivity gain or that an agent is necessary for this small domain.

## Limits and retained evidence

After the study, independent code review found two HTTP integration issues: live startup reconstructed the wrong script identity, and review retrieval could select a newer scripted thread instead of the reused live thread. Both were reproduced in real HTTP/workflow tests with an injected no-network model. The release now returns the registered workflow ID directly and binds review retrieval to the selected thread or current model configuration. Tests cover both fresh and previously scripted receipts, live-to-scripted-to-live reuse, scoped older proposal access and the resulting approval target. These integration fixes were verified offline; the paid observations above remain historical measurements of `dd76b84`.

There are twelve synthetic cases repeated three times, one model/configuration, and one successful development fixture. The held-out file split already existed in scripted and deterministic regression work; this is not an independent blind study. No held-out failure drove prompt tuning in this run. Automated evaluation decisions are harness actions, rather than observations of a human using the product.

Local incremental case summaries, completed reports and the durable usage ledger are retained under ignored `results/` and `data/`. Per-turn provider blocks were persisted during each investigation but their disposable evaluation databases were deleted after case cleanup; they are not available as complete transcripts for this study. Published evidence contains reviewed summaries and no credentials or raw thinking blocks. Production use, AWS operation and an independent human usefulness study remain unproven.

Deferred minor from review: optional retention/export of detailed live evaluation databases or transcripts for future investigations. This release still deletes those disposable per-case databases after returning the summary. The missing historical transcripts were not reconstructed or replaced with a new paid run.
