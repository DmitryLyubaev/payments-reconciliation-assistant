# Payments reconciliation assistant

A small TypeScript and LangGraph demonstration that investigates a synthetic rounding discrepancy, cites evidence, pauses for review and resumes after a process restart.

**Current mode: fake/scripted.** Authored replies exercise the real tools, graph, database, validation and approval boundaries. No real model has been evaluated, and no AWS deployment or production use is claimed.

![The local reviewer interface with an accepted explanation and unchanged source totals](docs/images/review.png)

## The example

Two fictional tax-exclusive items cost AUD 10.05 each. Under the fixture's explicit 10% tax and half-up rules:

| Calculation convention           |      Tax |     Gross |
| -------------------------------- | -------: | --------: |
| Round tax separately per item    | AUD 2.02 | AUD 22.12 |
| Sum the subtotal, then round tax | AUD 2.01 | AUD 22.11 |

The one-cent difference is explainable when the applicable fictional policies and item records are available. Accepting that explanation records a review decision. Both source totals remain intact. Missing evidence, conflicting facts and unexplained mismatches remain open.

These are invented calculation policies, not tax advice or a claim about real GST compliance. The compared exports are POS and accounting records; a payment provider is not depicted as recalculating sales tax.

## Run locally on Windows

Use Node **24.22.1**, the version pinned in `.node-version`.

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd start
```

Open the printed loopback address, normally `http://127.0.0.1:4313`. Select an example and choose **Load example**. The four examples cover rounding, missing policy, an unexplained mismatch and an exact match. The reviewer identity is explicitly `demo-reviewer`.

No credentials, subscription, hosted agent service or external financial account is needed. The app binds only to loopback. Runtime SQLite files are written under ignored `data/`. To use a separate dataset directory or port:

```powershell
npm.cmd start -- --data-dir data/demo-session --port 4313
```

If npm encounters an enterprise certificate-chain error on Windows, Node can use the machine's trusted system certificates for that process. Do not disable TLS verification:

```powershell
$env:NODE_USE_SYSTEM_CA = '1'
npm.cmd ci
```

## Verify

```powershell
npx.cmd playwright install chromium
npm.cmd run check
npm.cmd run evaluate:offline
```

`check` builds and typechecks the app, runs the Node suite and runs browser checks. Actual child processes test persisted review and four crash boundaries. The offline evaluator uses twelve frozen cases and compares outcomes with independent expected answers and a rules-only baseline. Its JSON/Markdown reports are written to ignored `results/`.

See the [dated offline report](docs/offline-report.md), [restart demonstration](docs/demo.md), [technical design](docs/design.md) and [evaluation method](docs/evaluation.md). The GitHub Actions workflow is prepared for offline checks; hosted CI has not run for this local repository.

## What the implementation demonstrates

- BigInt/rational money arithmetic, explicit rounding points and string minor units at persistence/API boundaries.
- Immutable source versions, deterministic evidence snapshots, idempotent imports and stale-approval rejection.
- Constrained evidence tools and a bounded, checkpointed LangGraph investigation.
- Proposal-specific review, durable decision intents and one terminal outcome under replay.
- A small same-origin review interface with text-only handling of imported content.
- Frozen development/held-out cases and honest separation of scripted tests from model quality.

The supported rounding domain is deliberately small. Ordinary deterministic rules can diagnose these cases, so this project does not claim that an AI agent is necessary or better. A later real-model study must measure any added value, latency and cost rather than assume it.

## Limits and next steps

The app supports synthetic AUD, positive tax-exclusive items, one fictional tax rate and a single local reviewer. It has no ledger, money movement, provider integration, real authentication, cloud availability guarantee or arbitrary upload endpoint. Unmatched counterparts show an unavailable difference instead of inventing zero.

The real-model port is intentionally disabled. Enabling paid runs requires choosing a provider/model, credentials and a spend limit in a separate milestone. A later AWS deployment needs its own architecture and operational evidence. Nothing in this repository establishes commercial cloud experience or production AI adoption.
