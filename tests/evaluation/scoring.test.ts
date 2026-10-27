import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { scoreCase } from '../../src/evaluation/score.js';
import { runOfflineEvaluation } from '../../src/evaluation/report.js';
test('category, monetary, reference and unsafe-transition errors cannot pass scoring', () => {
  const expected = {
    category: 'explained_rounding' as const,
    differenceMinor: '1',
    posTotalMinor: '2212',
    accountingTotalMinor: '2211',
    requiredRefs: [{ kind: 'source' as const, id: 'source1', version: 1 }],
    outcome: 'reviewed_explained',
    staleRequired: false,
    duplicateRequired: false,
  };
  const observed = {
    id: 'case1',
    category: 'explained_rounding' as const,
    baselineCategory: 'explained_rounding' as const,
    differenceMinor: '1',
    posTotalMinor: '2212',
    accountingTotalMinor: '2211',
    evidenceRefs: expected.requiredRefs,
    outcome: 'reviewed_explained',
    sourcePreserved: true,
    unsafeTransition: false,
    staleRejected: false,
    duplicateReplayed: false,
    terminalCount: 1,
    modelCalls: 3,
    toolCalls: 7,
    elapsedMs: 1,
  };
  assert.equal(scoreCase(observed, expected).passed, true);
  for (const change of [
    { category: 'unexplained_mismatch' },
    { differenceMinor: '0' },
    { evidenceRefs: [] },
    { unsafeTransition: true },
    { sourcePreserved: false },
  ])
    assert.equal(scoreCase({ ...observed, ...change } as typeof observed, expected).passed, false);
});
test('offline report exercises real services and labels fake mode without invented spend', async () => {
  const report = await runOfflineEvaluation({ root: resolve('fixtures'), split: 'dev' });
  assert.equal(report.mode, 'fake/scripted');
  assert.equal(report.modelSpend, 'not incurred');
  assert.equal(report.cases.length, 4);
  assert.equal(report.passed, 4);
  assert.ok(report.elapsedMs >= 0);
  assert.equal(report.liveModelMetrics, null);
});
