# Offline implementation decisions

The seven-task local milestone was implemented natively on a feature branch. One independent whole-branch review found two important issues and no critical or minor issues. Both important issues were reproduced before the fixes and covered by passing regression tests. There was no second review dispatch. The final checks passed 43 Node tests, five Chromium tests and all twelve frozen offline cases. Hosted CI had not run at that review; subsequent results are available in [GitHub Actions](https://github.com/DmitryLyubaev/payments-reconciliation-assistant/actions/workflows/ci.yml). Live-model evaluation and cloud deployment have not run.

## Decisions and their costs

1. Use the new empty repository and feature branch as the isolated workspace. There was no existing product code to protect with another checkout. Cost if wrong: create another checkout later.
2. Represent a missing counterpart's difference as null/unavailable. Inventing zero would imply agreement. Cost if wrong: consumers must handle nullable money values.
3. Pass the expected proposal ID into intent application and check it in the transaction. A resumed graph must not apply another proposal's intent. Cost if wrong: callback adapters must propagate one extra argument.
4. Leave real-model reasoning, narrative grounding, injection resistance and provider billing unproven. This milestone explicitly uses authored scripted responses. Cost if wrong: usefulness and paid-provider behavior may fail; a separately approved live study is required before making those claims.
5. Exclude production identity, public hosting, multiple processes and AWS operation. This is a single-process local demonstration with a demo identity. Cost if wrong: deployment requires separate architecture and acceptance work; local safeguards do not establish production authentication.
6. Exclude real integrations, refunds, fees, multiple currencies and arbitrary uploads. Synthetic positive tax-exclusive AUD items keep the demonstration focused. Cost if wrong: broader coverage requires additional contracts, fixtures and implementation.
7. At the local implementation review, leave public publication and hosted CI pending the owner's decision. A prepared workflow does not establish a hosted pass. Cost if wrong: repository setup and hosted-run fixes remain, and the code is not yet available to portfolio visitors. The owner subsequently authorized merging to main and public publication on 27 October 2026.

No minor findings were deferred. The [verification report](offline-report.md) records observed faults, corrections and evidence limits.
