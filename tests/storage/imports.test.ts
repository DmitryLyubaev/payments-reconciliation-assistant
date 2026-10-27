import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importFixture, loadSnapshot } from '../../src/storage/imports.js';
import { tempStore } from '../support/temp-store.js';
import { roundingFixture } from '../support/fixtures.js';

test('reimport and reordered equivalent data have a stable digest', () => {
  const t = tempStore();
  try {
    const f = roundingFixture();
    const first = importFixture(t.store, f);
    f.sources.reverse();
    f.policies.reverse();
    f.sources[0].lines!.reverse();
    const second = importFixture(t.store, f);
    assert.equal(first.status, 'imported');
    assert.equal(second.status, 'replayed');
    assert.deepEqual(
      'snapshotDigests' in second && second.snapshotDigests,
      'snapshotDigests' in first && first.snapshotDigests,
    );
  } finally {
    t.close();
  }
});
test('changed payload under same version is atomic conflict', () => {
  const t = tempStore();
  try {
    const f = roundingFixture();
    importFixture(t.store, f);
    const before = loadSnapshot(t.store, f.sources[0].batchId, f.sources[0].receiptId);
    f.sources.push({ ...f.sources[0], id: 'new-source' });
    f.sources[0].grossMinor = '2219';
    assert.deepEqual(importFixture(t.store, f), { status: 'rejected', code: 'VERSION_CONFLICT' });
    assert.deepEqual(loadSnapshot(t.store, before.batchId, before.receiptId), before);
    assert.equal(
      t.store.db.prepare('SELECT count(*) AS n FROM source_versions WHERE id=?').get('new-source')
        ?.n,
      0,
    );
  } finally {
    t.close();
  }
});
test('late old version does not downgrade a head and policy changes alter digest', () => {
  const t = tempStore();
  try {
    const original = roundingFixture();
    importFixture(t.store, original);
    const newer = structuredClone(original);
    newer.sources[0].version = 2;
    newer.sources[0].notes = 'new evidence';
    importFixture(t.store, newer);
    const head = loadSnapshot(t.store, newer.sources[0].batchId, newer.sources[0].receiptId);
    importFixture(t.store, original);
    assert.deepEqual(loadSnapshot(t.store, head.batchId, head.receiptId), head);
    newer.policies[0].version = 2;
    newer.policies[0].text = 'Updated fictional policy';
    importFixture(t.store, newer);
    assert.notEqual(loadSnapshot(t.store, head.batchId, head.receiptId).digest, head.digest);
  } finally {
    t.close();
  }
});
