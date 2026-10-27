# Offline verification report

Date: 27 October 2026. Mode: fake/scripted, synthetic data only.

Fresh installation with `npm ci` succeeded on Windows using Node 24.22.1. Typechecking, build and formatting checks passed. The release verification produced:

| Check                                             |     Observed result |
| ------------------------------------------------- | ------------------: |
| Node tests                                        | 43 passed, 0 failed |
| Chromium browser tests                            |            5 passed |
| Frozen held-out workflow cases                    | 12 passed, 0 failed |
| Rules-only baseline categories matching gold      |            12 of 12 |
| Scripted adapter attempts across the held-out run |                  30 |
| Evidence/calculation tool calls across that run   |                  68 |
| Held-out run elapsed time                         |          2,327.0 ms |
| Real-model spend                                  |        Not incurred |

The elapsed value is one local run over twelve cases, not a service-level guarantee or a model latency measurement. The [reviewed JSON summary](results/offline-2026-10-27.json) records each case, fixture/source digests, code version and dirty-tree status. It was measured before the delivery commit; the source digest identifies the measured implementation. Raw transcripts and runtime databases are not published.

The Node suite passed all four actual crash/relaunch boundaries. A separate run of the compiled CLI through HTTP also verified a real server restart: the session token changed, the same proposal and evidence digest returned, replayed approval produced one outcome and one terminal audit event, original amounts stayed at 2,212 and 2,211 cents, and the scripted model-attempt count remained three.

Desktop and 360px browser layouts were inspected. Browser tests cover text-only rendering of imported markup, the absence of acceptance when evidence is missing, and delayed evidence/review responses after switching receipts. At the time of this local verification, the GitHub workflow was prepared and had not run on a hosted runner. Subsequent hosted results are available in [GitHub Actions](https://github.com/DmitryLyubaev/payments-reconciliation-assistant/actions/workflows/ci.yml).

## Observed failures and corrections

- A retry test observed two reported model attempts where three had occurred. Attempt reservation now increments the counter before invocation, including failed attempts. The regression verifies the three-attempt sequence and the one-retry limit.
- A configuration-order test showed that reversing scripted model steps reused the old investigation. A generic hash helper had treated all arrays as sets. Hashing now preserves ordered sequences; evidence import normalizes its own unordered collections explicitly. The regression verifies a changed script gets a distinct investigation, while reordered equivalent evidence still replays.
- Independent code review found that individually correct source calculations could receive a rounding explanation despite different underlying items. Regression cases cover different subtotals and equal subtotals with different item amounts. Classification now requires shared item identity/net amounts, proposal validation rejects a false rounding explanation, and approval remains unavailable. Acknowledgement leaves the exception open and originals unchanged.
- Review also reproduced a delayed response showing a previous receipt's evidence beside the newly selected receipt. Browser regression tests delayed real HTTP responses. The client now discards outdated evidence and review refreshes using selection/request identity and current references.

The twelve frozen cases passed again after these review fixes; their manifest and bytes were unchanged. This rerun is regression evidence, rather than a new independent model evaluation. The initial recorded run was 1,528.9 ms; the table and JSON above report the final rerun.

These were observed software-test failures, not claims of model drift or production incidents.

## Evidence boundaries

The offline evaluator measures workflow contracts with authored replies. It does not measure real-model reasoning, production adoption, independent human agreement or cloud operation. The rules-only baseline can diagnose this deliberately small domain. No AI superiority or productivity benefit is claimed.
