import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyse } from '../../src/domain/reconcile.js';
import { roundingFixture, fixtureSnapshot } from '../support/fixtures.js';

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
