import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LiveBudget } from '../../src/investigation/live-budget.js';

test('paid reservations cannot exceed the total cap and unknown billing survives reopen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'payment budget '));
  let budget = new LiveBudget(join(dir, 'budget.sqlite'));
  try {
    const first = budget.reserve({ threadId: 'a', turn: 0 });
    budget.reserve({ threadId: 'b', turn: 0 });
    assert.throws(() => budget.reserve({ threadId: 'c', turn: 0 }), /BUDGET_LIMIT/);
    assert.equal(budget.summary().committedNanoUsd, '4081920000');
    budget.settle(first, { input_tokens: 1000, output_tokens: 100 }, 'request-1');
    assert.equal(budget.summary().spentNanoUsd, '3000000');
    assert.equal(budget.summary().committedNanoUsd, '2043960000');
    budget.close();
    budget = new LiveBudget(join(dir, 'budget.sqlite'));
    assert.equal(budget.summary().unsettledCalls, 1);
    assert.equal(budget.summary().committedNanoUsd, '2043960000');
    budget.reserve({ threadId: 'c', turn: 0 });
    assert.throws(() => budget.reserve({ threadId: 'd', turn: 0 }), /BUDGET_LIMIT/);
  } finally {
    budget.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('invalid caps or provider usage cannot release a spending reservation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'payment budget invalid '));
  const path = join(dir, 'budget.sqlite');
  assert.throws(() => new LiveBudget(path, 5000000001n), /BUDGET_CAP/);
  const budget = new LiveBudget(path);
  try {
    const id = budget.reserve({ threadId: 'a', turn: 0 });
    for (const usage of [
      {},
      { input_tokens: -1, output_tokens: 1 },
      { input_tokens: 1, output_tokens: 4097 },
      { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 1 },
    ]) {
      assert.throws(() => budget.settle(id, usage, 'bad'), /INVALID_USAGE/);
      assert.equal(budget.summary().committedNanoUsd, '2040960000');
    }
    budget.settle(id, { input_tokens: 1000, output_tokens: 100 }, 'ok');
    assert.throws(
      () => budget.settle(id, { input_tokens: 1, output_tokens: 1 }, 'changed'),
      /USAGE_CONFLICT/,
    );
  } finally {
    budget.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
