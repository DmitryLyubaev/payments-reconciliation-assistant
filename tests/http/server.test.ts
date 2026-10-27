import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { createServer } from '../../src/http/server.js';
import { createWorkflow, type WorkflowDeps } from '../../src/workflow/graph.js';
import { importFixture, loadSnapshot } from '../../src/storage/imports.js';
import { createFakeModel } from '../../src/investigation/fake-model.js';
import { LIVE_IDENTITY } from '../../src/investigation/live-config.js';
import { startRunner } from '../../src/workflow/runner.js';
import { applyIntent } from '../../src/workflow/decisions.js';
import { tempStore } from '../support/temp-store.js';
import { roundingFixture, roundingScript } from '../support/fixtures.js';
async function setup(
  runtimeMode: 'fake/scripted' | 'anthropic' = 'fake/scripted',
  live?: WorkflowDeps['live'],
) {
  const t = tempStore();
  const workflow = createWorkflow({
    store: t.store,
    live,
    applyIntent: (id, expected) => applyIntent(t.store, id, undefined, expected),
  });
  const runner = startRunner({ store: t.store, workflow });
  const f = roundingFixture('dev-rounding');
  const server = await createServer({
    store: t.store,
    workflow,
    runner,
    fixtures: [{ id: f.id, label: 'GST rounding', data: f, script: roundingScript(f) }],
    port: 0,
    runtimeMode,
    modelVersion: runtimeMode === 'anthropic' ? 'claude-sonnet-5-5' : 'fake-scripted-v1',
  });
  const token = (await (await fetch(server.origin + '/api/session')).json()).token;
  const post = (path: string, body: unknown, extra: Record<string, string> = {}) =>
    fetch(server.origin + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-session-token': token, ...extra },
      body: JSON.stringify(body),
    });
  return {
    ...t,
    server,
    workflow,
    runner,
    post,
    token,
    f,
    async finish() {
      await server.close();
      await runner.close();
      await workflow.close();
      t.close();
    },
  };
}

test('live HTTP startup returns its registered thread on fresh and previously scripted receipts', async () => {
  for (const priorFake of [false, true]) {
    const f = roundingFixture('dev-rounding');
    const t = await setup('anthropic', {
      identity: LIVE_IDENTITY,
      adapter: createFakeModel(roundingScript(f)),
    });
    try {
      assert.equal((await t.post('/api/imports', { fixtureId: t.f.id })).status, 200);
      const snapshot = loadSnapshot(t.store, f.sources[0].batchId, f.sources[0].receiptId);
      let oldThread: string | undefined;
      if (priorFake) {
        const fake = createWorkflow({
          store: t.store,
          applyIntent: (id, expected) => applyIntent(t.store, id, undefined, expected),
        });
        try {
          oldThread = (await fake.start(snapshot, roundingScript(f))).threadId;
        } finally {
          await fake.close();
        }
      }
      const response = await t.post(
        '/api/batches/dev-rounding-batch/receipts/dev-rounding-receipt/investigations',
        {},
      );
      assert.equal(response.status, 202, `priorFake=${priorFake}`);
      const started = await response.json();
      const saved = await t.workflow.start(snapshot, roundingScript(f));
      assert.equal(started.threadId, saved.threadId);
      assert.notEqual(started.threadId, oldThread);
      assert.equal(saved.status, 'awaiting_review');
    } finally {
      await t.finish();
    }
  }
});

test('live review selects the reused live thread and preserves explicit older proposal access', async () => {
  const f = roundingFixture('dev-rounding');
  const t = await setup('anthropic', {
    identity: LIVE_IDENTITY,
    adapter: createFakeModel(roundingScript(f)),
  });
  try {
    importFixture(t.store, f);
    const snapshot = loadSnapshot(t.store, f.sources[0].batchId, f.sources[0].receiptId);
    const live = await t.workflow.start(snapshot, roundingScript(f));
    const fakeFlow = createWorkflow({
      store: t.store,
      applyIntent: (id, expected) => applyIntent(t.store, id, undefined, expected),
    });
    let fake;
    try {
      fake = await fakeFlow.start(snapshot, roundingScript(f));
    } finally {
      await fakeFlow.close();
    }
    assert.equal((await t.workflow.start(snapshot, roundingScript(f))).threadId, live.threadId);
    const base =
      t.server.origin + '/api/batches/dev-rounding-batch/receipts/dev-rounding-receipt/review';
    const selected = await (await fetch(base + '?threadId=' + live.threadId)).json();
    assert.equal(selected.proposal.id, live.proposalId);
    assert.equal(selected.proposal.modelVersion, 'claude-sonnet-5-5');
    assert.equal((await (await fetch(base)).json()).proposal.id, live.proposalId);
    const deliberate = await (await fetch(base + '?threadId=' + fake.threadId)).json();
    assert.equal(deliberate.proposal.id, fake.proposalId);
    assert.equal(deliberate.proposal.modelVersion, 'fake-scripted-v1');
    assert.equal((await fetch(base + '?threadId=another-receipt')).status, 404);
    await t.post('/api/decisions', {
      proposalId: selected.proposal.id,
      proposalVersion: selected.proposal.version,
      snapshotDigest: selected.proposal.snapshotDigest,
      idempotencyKey: 'selected-live',
      decision: 'accept',
    });
    await t.runner.wake();
    assert.equal(
      (await (await fetch(base + '?threadId=' + live.threadId)).json()).outcome,
      'reviewed_explained',
    );
    assert.equal((await (await fetch(base + '?threadId=' + fake.threadId)).json()).outcome, null);
  } finally {
    await t.finish();
  }
});

test('session publishes the configured runtime model without provider credentials', async () => {
  const t = await setup('anthropic');
  try {
    const session = await (await fetch(t.server.origin + '/api/session')).json();
    assert.equal(session.mode, 'anthropic');
    assert.equal(session.modelVersion, 'claude-sonnet-5-5');
    assert.deepEqual(Object.keys(session).sort(), ['mode', 'modelVersion', 'reviewer', 'token']);
  } finally {
    await t.finish();
  }
});
test('session, origin and host checks protect mutations', async () => {
  const t = await setup();
  try {
    assert.equal(
      (await t.post('/api/imports', { fixtureId: t.f.id }, { 'x-session-token': 'wrong' })).status,
      403,
    );
    assert.equal(
      (await t.post('/api/imports', { fixtureId: t.f.id }, { origin: 'https://foreign.example' }))
        .status,
      403,
    );
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        t.server.origin + '/api/imports',
        { method: 'POST', headers: { Host: 'foreign.example', 'x-session-token': t.token } },
        (res) => {
          res.resume();
          resolve(res.statusCode!);
        },
      );
      req.on('error', reject);
      req.end('{}');
    });
    assert.equal(status, 403);
  } finally {
    await t.finish();
  }
});
test('bounded JSON and explicit routes reject invalid requests without stopping server', async () => {
  const t = await setup();
  try {
    assert.equal((await t.post('/api/imports', { fixtureId: 'unknown' })).status, 404);
    assert.equal((await t.post('/api/imports', { blob: 'x'.repeat(33000) })).status, 413);
    assert.equal(
      (
        await fetch(t.server.origin + '/api/imports', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-session-token': t.token },
          body: '{broken',
        })
      ).status,
      400,
    );
    assert.equal((await fetch(t.server.origin + '/fixtures/heldout/gold/h01.json')).status, 404);
    assert.equal((await fetch(t.server.origin + '/api/session')).status, 200);
  } finally {
    await t.finish();
  }
});
test('real HTTP review applies one decision and retains original amounts', async () => {
  const t = await setup();
  try {
    assert.equal((await t.post('/api/imports', { fixtureId: t.f.id })).status, 200);
    const s = t.f.sources[0];
    const base = `/api/batches/${s.batchId}/receipts/${s.receiptId}`;
    assert.equal((await t.post(base + '/investigations', {})).status, 202);
    let view = await (await fetch(t.server.origin + base + '/review')).json();
    const deadline = Date.now() + 5000;
    while (view.status === 'investigating' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
      view = await (await fetch(t.server.origin + base + '/review')).json();
    }
    assert.equal(view.status, 'awaiting_review');
    assert.equal(view.posTotalMinor, '2212');
    assert.equal(view.accountingTotalMinor, '2211');
    const requestBody = {
      proposalId: view.proposal.id,
      proposalVersion: view.proposal.version,
      snapshotDigest: view.proposal.snapshotDigest,
      idempotencyKey: 'http-accept',
      decision: 'accept',
    };
    const a = await (await t.post('/api/decisions', requestBody)).json();
    const b = await (await t.post('/api/decisions', requestBody)).json();
    assert.equal(a.intentId, b.intentId);
    await t.runner.wake();
    const final = await (await fetch(t.server.origin + base + '/review')).json();
    assert.equal(final.outcome, 'reviewed_explained');
    assert.equal(final.posTotalMinor, '2212');
    assert.equal(final.accountingTotalMinor, '2211');
  } finally {
    await t.finish();
  }
});
