import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { LiveBudget } from '../../src/investigation/live-budget.js';
import { LIVE_IDENTITY } from '../../src/investigation/live-config.js';
import { runLiveEvaluation } from '../../src/evaluation/live-report.js';

test('live evaluation uses shared scoring, bypasses matches and records unknown billing honestly', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'payment live report '));
  const budget = new LiveBudget(join(dir, 'budget.sqlite'));
  let calls = 0;
  try {
    const report = await runLiveEvaluation({
      root: resolve('fixtures'),
      split: 'dev',
      passes: 1,
      budget,
      binding: {
        identity: LIVE_IDENTITY,
        adapter: {
          async next(input) {
            calls++;
            budget.reserve({ threadId: input.threadId, turn: input.turn });
            throw new Error('TEST_PROVIDER_FAILURE');
          },
        },
      },
    });
    assert.equal(report.cases.length, 4);
    assert.equal(calls, 3);
    assert.equal(report.cases.find((c) => c.id === 'dev-matched')?.modelCalls, 0);
    assert.equal(report.cases.find((c) => c.id === 'dev-rounding')?.category, 'failed');
    assert.equal(report.unsettledCalls, 2);
    assert.equal(report.actualSpendUsd, null);
    assert.equal(report.committedUpperBoundUsd, '4.081920000');
    assert.equal(report.baselineCorrect, 4);
    assert.equal(report.passed, 1);
  } finally {
    budget.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('live evaluation rejects unbounded repetitions before invoking a model', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'payment live count '));
  const budget = new LiveBudget(join(dir, 'budget.sqlite'));
  try {
    await assert.rejects(
      runLiveEvaluation({
        root: resolve('fixtures'),
        split: 'heldout',
        passes: 4,
        budget,
        binding: {
          identity: LIVE_IDENTITY,
          adapter: {
            async next() {
              throw new Error('MUST_NOT_CALL');
            },
          },
        },
      }),
      /INVALID_PASSES/,
    );
  } finally {
    budget.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
