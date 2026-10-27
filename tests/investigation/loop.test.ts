import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialInvestigationState, stepInvestigation } from '../../src/investigation/loop.js';
import { createTools } from '../../src/investigation/tools.js';
import { createFakeModel } from '../../src/investigation/fake-model.js';
import { analyse } from '../../src/domain/reconcile.js';
import { tempStore } from '../support/temp-store.js';
import { roundingFixture, fixtureSnapshot, roundingScript } from '../support/fixtures.js';
import type { ModelAdapter } from '../../src/investigation/contracts.js';
async function run(steps: unknown[], now?: () => number) {
  const t = tempStore();
  try {
    const snapshot = fixtureSnapshot(roundingFixture());
    let state = initialInvestigationState('thread1', snapshot, 0);
    const deps = {
      store: t.store,
      snapshot,
      analysis: analyse(snapshot),
      tools: createTools(t.store, snapshot),
      model: createFakeModel({ id: 'script', version: '1', steps }),
      now: now ?? (() => 0),
    };
    for (let i = 0; i < 10 && !state.result; i++) state = await stepInvestigation(deps, state);
    return state;
  } finally {
    t.close();
  }
}
test('limits stop excessive tools, model attempts and elapsed time', async () => {
  assert.deepEqual(
    (
      await run([
        {
          type: 'tools',
          calls: Array.from({ length: 9 }, (_, i) => ({
            id: `c${i}`,
            name: 'listEvidence',
            args: {},
          })),
        },
      ])
    ).result,
    { status: 'failed', code: 'TOOL_LIMIT' },
  );
  assert.deepEqual(
    (await run(Array.from({ length: 7 }, () => ({ type: 'tools', calls: [] })))).result,
    { status: 'failed', code: 'MODEL_LIMIT' },
  );
  assert.deepEqual((await run([], () => 60001)).result, { status: 'failed', code: 'TIME_LIMIT' });
});
test('unknown tools terminate safely and transient retry is bounded', async () => {
  assert.deepEqual(
    (await run([{ type: 'tools', calls: [{ id: 'c1', name: 'deleteEverything', args: {} }] }]))
      .result,
    { status: 'failed', code: 'UNKNOWN_TOOL' },
  );
  const retried = await run([
    { error: 'TRANSIENT' },
    { type: 'tools', calls: [] },
    { error: 'TRANSIENT' },
  ]);
  assert.equal(retried.turns, 3);
  assert.deepEqual(retried.result, { status: 'failed', code: 'TRANSIENT' });
});
test('a non-resolving adapter is stopped at its deadline', async () => {
  const t = tempStore();
  try {
    const snapshot = fixtureSnapshot(roundingFixture());
    const model: ModelAdapter = {
      async next() {
        return new Promise(() => {});
      },
    };
    const state = initialInvestigationState('hang', snapshot, Date.now());
    state.deadline = Date.now() + 25;
    const result = await stepInvestigation(
      {
        store: t.store,
        snapshot,
        analysis: analyse(snapshot),
        model,
        tools: createTools(t.store, snapshot),
      },
      state,
    );
    assert.deepEqual(result.result, { status: 'failed', code: 'TIME_LIMIT' });
  } finally {
    t.close();
  }
});
test('one transient retry can recover to a validated evidence-backed proposal', async () => {
  const script = roundingScript(roundingFixture());
  const state = await run([{ error: 'TRANSIENT' }, ...script.steps]);
  assert.equal(state.turns, 4);
  assert.equal(state.toolCalls, 7);
  assert.equal(state.result?.status, 'proposal');
});
