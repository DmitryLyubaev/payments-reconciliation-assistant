import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkflow } from '../../src/workflow/graph.js';
import { applyIntent } from '../../src/workflow/decisions.js';
import { importFixture, loadSnapshot } from '../../src/storage/imports.js';
import { createFakeModel } from '../../src/investigation/fake-model.js';
import { LIVE_IDENTITY } from '../../src/investigation/live-config.js';
import { tempStore } from '../support/temp-store.js';
import { openStore } from '../../src/storage/store.js';
import { roundingFixture, roundingScript } from '../support/fixtures.js';

test('legacy application databases migrate and retain their paused scripted proposal', async () => {
  const t = tempStore();
  const f = roundingFixture();
  importFixture(t.store, f);
  const flow = createWorkflow({
    store: t.store,
    applyIntent: (id, expected) => applyIntent(t.store, id, undefined, expected),
  });
  const view = await flow.start(
    loadSnapshot(t.store, f.sources[0].batchId, f.sources[0].receiptId),
    roundingScript(f),
  );
  await flow.close();
  t.store.db.exec('ALTER TABLE investigations DROP COLUMN model_json');
  t.store.close();
  const migrated = openStore(t.dir);
  const recovered = createWorkflow({
    store: migrated,
    applyIntent: (id, expected) => applyIntent(migrated, id, undefined, expected),
  });
  try {
    assert.equal((await recovered.recover(view.threadId)).proposalId, view.proposalId);
  } finally {
    await recovered.close();
    migrated.close();
    t.close();
  }
});

test('live and fake configurations cannot reuse proposals and real identity survives review recovery', async () => {
  const t = tempStore();
  const f = roundingFixture();
  importFixture(t.store, f);
  const snapshot = loadSnapshot(t.store, f.sources[0].batchId, f.sources[0].receiptId);
  const fake = createWorkflow({
    store: t.store,
    applyIntent: (id, expected) => applyIntent(t.store, id, undefined, expected),
  });
  let live: ReturnType<typeof createWorkflow> | undefined;
  try {
    const original = await fake.start(snapshot, roundingScript(f));
    await fake.close();
    let calls = 0;
    const adapter = createFakeModel(roundingScript(f));
    live = createWorkflow({
      store: t.store,
      applyIntent: (id, expected) => applyIntent(t.store, id, undefined, expected),
      live: {
        identity: LIVE_IDENTITY,
        adapter: {
          next: (input, signal) => {
            calls++;
            return adapter.next(input, signal);
          },
        },
      },
    });
    const first = await live.start(snapshot, roundingScript(f));
    assert.equal(first.status, 'awaiting_review');
    assert.notEqual(first.threadId, original.threadId);
    const proposal = JSON.parse(
      (
        t.store.db.prepare('SELECT payload FROM proposals WHERE id=?').get(first.proposalId) as {
          payload: string;
        }
      ).payload,
    );
    assert.equal(proposal.modelVersion, 'claude-sonnet-5-5');
    assert.equal((await live.start(snapshot, roundingScript(f))).threadId, first.threadId);
    const before = calls;
    await live.recover(first.threadId);
    assert.equal(calls, before);
  } finally {
    await live?.close();
    await fake.close();
    t.close();
  }
});

test('incompatible recovery makes no model call and preserves a pending investigation', async () => {
  const t = tempStore();
  const f = roundingFixture();
  importFixture(t.store, f);
  const flow = createWorkflow({
    store: t.store,
    applyIntent: (id, expected) => applyIntent(t.store, id, undefined, expected),
  });
  try {
    const snapshot = loadSnapshot(t.store, f.sources[0].batchId, f.sources[0].receiptId);
    const view = await flow.start(snapshot, roundingScript(f));
    t.store.db
      .prepare("UPDATE investigations SET model_json=?,status='investigating' WHERE id=?")
      .run(JSON.stringify(LIVE_IDENTITY), view.threadId);
    await assert.rejects(flow.recover(view.threadId), /MODEL_CONFIG_MISMATCH/);
    assert.equal(
      (
        t.store.db.prepare('SELECT status FROM investigations WHERE id=?').get(view.threadId) as {
          status: string;
        }
      ).status,
      'investigating',
    );
  } finally {
    await flow.close();
    t.close();
  }
});
