import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyse } from '../../src/domain/reconcile.js';
import { roundingFixture, fixtureSnapshot, mismatchedItemFixtures } from '../support/fixtures.js';

test('individually correct source calculations cannot explain different underlying items', () => {
  for (const { fixture, differenceMinor } of mismatchedItemFixtures()) {
    const result = analyse(fixtureSnapshot(fixture));
    assert.equal(result.category, 'unexplained_mismatch', fixture.id);
    assert.equal(result.eligible, false);
    assert.equal(result.differenceMinor, differenceMinor);
  }
});

test('shared item identity is required, while item ordering is irrelevant', () => {
  const fixture = structuredClone(roundingFixture());
  fixture.sources[1].lines = fixture.sources[1].lines!.map((line) => ({ ...line })).reverse();
  assert.equal(analyse(fixtureSnapshot(fixture)).eligible, true);
  fixture.sources[1].lines![0].id = 'different-item';
  assert.equal(analyse(fixtureSnapshot(fixture)).category, 'unexplained_mismatch');
});

test('rounding explains one cent without changing sources', () => {
  const s = fixtureSnapshot(roundingFixture());
  const a = analyse(s);
  assert.equal(a.category, 'explained_rounding');
  assert.equal(a.differenceMinor, '1');
  assert.equal(a.eligible, true);
  assert.deepEqual(
    s.sources.map((v) => v.grossMinor),
    ['2212', '2211'],
  );
});
test('categories distinguish missing, conflicting and unexplained evidence', () => {
  const missing = roundingFixture();
  missing.policies = [];
  assert.equal(analyse(fixtureSnapshot(missing)).category, 'insufficient_evidence');
  const detail = roundingFixture();
  detail.sources[0].lines = null;
  assert.equal(analyse(fixtureSnapshot(detail)).category, 'insufficient_evidence');
  const conflict = roundingFixture();
  conflict.sources[0].grossMinor = '2213';
  conflict.policies = [];
  assert.equal(analyse(fixtureSnapshot(conflict)).category, 'contradictory_evidence');
  const unexplained = roundingFixture();
  unexplained.sources[0].taxMinor = '204';
  unexplained.sources[0].grossMinor = '2214';
  assert.equal(analyse(fixtureSnapshot(unexplained)).category, 'unexplained_mismatch');
  const matched = roundingFixture();
  matched.sources[0].taxMinor = '201';
  matched.sources[0].grossMinor = '2211';
  assert.equal(analyse(fixtureSnapshot(matched)).category, 'matched');
});
test('missing counterpart cannot manufacture a zero difference', () => {
  const f = roundingFixture();
  f.sources.pop();
  const a = analyse(fixtureSnapshot(f));
  assert.equal(a.category, 'insufficient_evidence');
  assert.equal(a.differenceMinor, null);
});
