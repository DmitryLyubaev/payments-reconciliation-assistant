import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkflow } from '../../src/workflow/graph.js';
import { importFixture, loadSnapshot } from '../../src/storage/imports.js';
import { tempStore } from '../support/temp-store.js';
import { roundingFixture, roundingScript, outcomeScript } from '../support/fixtures.js';
test('graph pauses an immutable proposal and repeated start reuses it', async () => {
  const t = tempStore();
  const flow = createWorkflow({
    store: t.store,
    applyIntent: () => {
      throw new Error('unused');
    },
  });
  try {
    const f = roundingFixture();
    importFixture(t.store, f);
    const s = loadSnapshot(t.store, f.sources[0].batchId, f.sources[0].receiptId);
    const first = await flow.start(s, roundingScript(f));
    assert.equal(first.status, 'awaiting_review');
    assert.ok(first.proposalId);
    assert.deepEqual(await flow.start(s, roundingScript(f)), first);
    assert.equal(
      (t.store.db.prepare('SELECT count(*) AS n FROM proposals').get() as { n: number }).n,
      1,
    );
  } finally {
    await flow.close();
    t.close();
  }
});
test('missing, contradictory and unexplained proposals pause as unresolved', async () => {
  const t = tempStore();
  const flow = createWorkflow({
    store: t.store,
    applyIntent: () => {
      throw new Error('unused');
    },
  });
  try {
    for (const [category, diff] of [
      ['insufficient_evidence', '1'],
      ['contradictory_evidence', '2'],
      ['unexplained_mismatch', '3'],
    ] as const) {
      const f = roundingFixture(category);
      if (category === 'insufficient_evidence') f.policies = [];
      else if (category === 'contradictory_evidence') f.sources[0].grossMinor = '2213';
      else {
        f.sources[0].taxMinor = '204';
        f.sources[0].grossMinor = '2214';
      }
      importFixture(t.store, f);
      const s = loadSnapshot(t.store, f.sources[0].batchId, f.sources[0].receiptId);
      const view = await flow.start(s, outcomeScript(f, category, diff));
      assert.equal(view.status, 'awaiting_review');
      const p = t.store.db
        .prepare('SELECT payload FROM proposals WHERE id=?')
        .get(view.proposalId) as { payload: string };
      assert.equal(JSON.parse(p.payload).category, category);
    }
  } finally {
    await flow.close();
    t.close();
  }
});
test('exact match bypasses model and malformed replies leave auditable failure', async () => {
  const t = tempStore();
  const flow = createWorkflow({
    store: t.store,
    applyIntent: () => {
      throw new Error('unused');
    },
  });
  try {
    const f = roundingFixture();
    f.sources[0].grossMinor = '2211';
    f.sources[0].taxMinor = '201';
    importFixture(t.store, f);
    const s = loadSnapshot(t.store, f.sources[0].batchId, f.sources[0].receiptId);
    const match = await flow.start(s, { id: 'empty', version: '1', steps: [] });
    assert.equal(match.status, 'matched');
    assert.equal(
      (t.store.db.prepare('SELECT count(*) AS n FROM model_attempts').get() as { n: number }).n,
      0,
    );
    const other = roundingFixture('bad');
    importFixture(t.store, other);
    const bad = await flow.start(
      loadSnapshot(t.store, other.sources[0].batchId, other.sources[0].receiptId),
      { id: 'malformed', version: '1', steps: [{ bad: true }] },
    );
    assert.equal(bad.status, 'failed');
    assert.ok(t.store.history(bad.threadId).some((e) => e.type === 'investigation_failed'));
  } finally {
    await flow.close();
    t.close();
  }
});
test('changing scripted step order cannot reuse an existing investigation', async () => {
  const t = tempStore();
  const flow = createWorkflow({
    store: t.store,
    applyIntent: () => {
      throw new Error('unused');
    },
  });
  try {
    const f = roundingFixture();
    importFixture(t.store, f);
    const snapshot = loadSnapshot(t.store, f.sources[0].batchId, f.sources[0].receiptId);
    const script = roundingScript(f);
    const first = await flow.start(snapshot, script);
    const reordered = { ...script, steps: [...script.steps].reverse() };
    const second = await flow.start(snapshot, reordered);
    assert.notEqual(second.threadId, first.threadId);
    assert.equal(second.status, 'failed');
  } finally {
    await flow.close();
    t.close();
  }
});
