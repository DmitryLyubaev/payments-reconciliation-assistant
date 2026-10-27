import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordDecision, applyIntent } from '../../src/workflow/decisions.js';
import { createWorkflow } from '../../src/workflow/graph.js';
import { recoverPending } from '../../src/workflow/runner.js';
import { importFixture, loadSnapshot } from '../../src/storage/imports.js';
import { tempStore } from '../support/temp-store.js';
import { roundingFixture, roundingScript, outcomeScript } from '../support/fixtures.js';
import type { Proposal, DecisionRequest } from '../../src/investigation/contracts.js';
async function setup(missing = false) {
  const t = tempStore();
  const flow = createWorkflow({ store: t.store, applyIntent: (id) => applyIntent(t.store, id) });
  const f = roundingFixture();
  if (missing) f.policies = [];
  importFixture(t.store, f);
  const snapshot = loadSnapshot(t.store, f.sources[0].batchId, f.sources[0].receiptId);
  const view = await flow.start(
    snapshot,
    missing ? outcomeScript(f, 'insufficient_evidence', '1') : roundingScript(f),
  );
  const p = JSON.parse(
    (
      t.store.db.prepare('SELECT payload FROM proposals WHERE id=?').get(view.proposalId) as {
        payload: string;
      }
    ).payload,
  ) as Proposal;
  const request: DecisionRequest = {
    proposalId: p.id,
    proposalVersion: p.version,
    snapshotDigest: p.snapshotDigest,
    idempotencyKey: 'decision-1',
    decision: 'accept',
  };
  return {
    ...t,
    flow,
    f,
    p,
    request,
    async finish() {
      await flow.close();
      t.close();
    },
  };
}
test('concurrent replay gives one intent and one durable outcome', async () => {
  const t = await setup();
  try {
    const [a, b] = await Promise.all([
      Promise.resolve().then(() => recordDecision(t.store, t.request)),
      Promise.resolve().then(() => recordDecision(t.store, t.request)),
    ]);
    assert.equal(a.intentId, b.intentId);
    assert.equal(b.replayed, true);
    await recoverPending({ store: t.store, workflow: t.flow });
    await recoverPending({ store: t.store, workflow: t.flow });
    assert.equal(
      (t.store.db.prepare('SELECT count(*) AS n FROM outcomes').get() as { n: number }).n,
      1,
    );
    assert.equal(
      (
        t.store.db
          .prepare("SELECT count(*) AS n FROM audit_events WHERE type='terminal_outcome'")
          .get() as { n: number }
      ).n,
      1,
    );
    assert.throws(() => recordDecision(t.store, { ...t.request, decision: 'reject' }), /CONFLICT/);
    assert.throws(
      () =>
        recordDecision(t.store, { ...t.request, idempotencyKey: 'another', decision: 'reject' }),
      /CONFLICT/,
    );
  } finally {
    await t.finish();
  }
});
test('stale evidence refuses approval and a saved intent is invalidated by a race', async () => {
  const t = await setup();
  try {
    const intent = recordDecision(t.store, t.request);
    t.f.sources[0].version = 2;
    t.f.sources[0].notes = 'Changed evidence';
    importFixture(t.store, t.f);
    assert.throws(() => recordDecision(t.store, { ...t.request, idempotencyKey: 'new' }), /STALE/);
    assert.equal(applyIntent(t.store, intent.intentId).state, 'invalidated');
    assert.equal(
      (t.store.db.prepare('SELECT outcome FROM outcomes').get() as { outcome: string }).outcome,
      'open_unresolved',
    );
  } finally {
    await t.finish();
  }
});
test('rejecting or acknowledging leaves originals unchanged and exceptions open', async () => {
  for (const missing of [false, true]) {
    const t = await setup(missing);
    try {
      if (missing) assert.throws(() => recordDecision(t.store, t.request), /INELIGIBLE/);
      const intent = recordDecision(t.store, {
        ...t.request,
        decision: missing ? 'acknowledge' : 'reject',
      });
      assert.equal(applyIntent(t.store, intent.intentId).outcome, 'open_unresolved');
      const s = loadSnapshot(t.store, t.f.sources[0].batchId, t.f.sources[0].receiptId);
      assert.deepEqual(s.sources.map((s) => s.grossMinor).sort(), ['2211', '2212']);
    } finally {
      await t.finish();
    }
  }
});
test('startup consumes multiple receipts without losing another receipt', async () => {
  const t = await setup();
  try {
    recordDecision(t.store, t.request);
    const f = roundingFixture('second');
    importFixture(t.store, f);
    const v = await t.flow.start(
      loadSnapshot(t.store, f.sources[0].batchId, f.sources[0].receiptId),
      roundingScript(f),
    );
    const p = JSON.parse(
      (
        t.store.db.prepare('SELECT payload FROM proposals WHERE id=?').get(v.proposalId) as {
          payload: string;
        }
      ).payload,
    ) as Proposal;
    recordDecision(t.store, {
      ...t.request,
      proposalId: p.id,
      snapshotDigest: p.snapshotDigest,
      idempotencyKey: 'decision-2',
    });
    const summary = await recoverPending({ store: t.store, workflow: t.flow });
    assert.equal(summary.applied, 2);
  } finally {
    await t.finish();
  }
});
test('a decision cannot be applied on behalf of a different proposal', async () => {
  const t = await setup();
  try {
    const intent = recordDecision(t.store, t.request);
    assert.throws(
      () => applyIntent(t.store, intent.intentId, undefined, 'different-proposal'),
      /INTENT_SCOPE/,
    );
    assert.equal(
      (t.store.db.prepare('SELECT count(*) AS n FROM outcomes').get() as { n: number }).n,
      0,
    );
  } finally {
    await t.finish();
  }
});
