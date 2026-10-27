import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyse } from '../../src/domain/reconcile.js';
import { validateProposal } from '../../src/investigation/validate.js';
import { roundingFixture, fixtureSnapshot, mismatchedItemFixtures } from '../support/fixtures.js';

test('proposal validation rejects a rounding explanation when source items disagree', () => {
  for (const { fixture, differenceMinor } of mismatchedItemFixtures()) {
    const snapshot = fixtureSnapshot(fixture);
    const analysis = analyse(snapshot);
    const candidate = {
      id: 'false-rounding',
      version: 1,
      snapshotDigest: snapshot.digest,
      category: 'explained_rounding',
      differenceMinor,
      evidenceRefs: analysis.requiredRefs,
      calculationIds: analysis.calculations.map((c) => c.id),
      explanation: 'Rounding explains the difference.',
      nextStep: 'Review',
      modelVersion: 'fake-v1',
      promptVersion: 'v1',
    };
    assert.throws(
      () => validateProposal(candidate, snapshot, analysis, analysis.calculations),
      /INVALID_PROPOSAL/,
      fixture.id,
    );
  }
});
test('proposal validation rejects fabricated amounts and missing evidence', () => {
  const s = fixtureSnapshot(roundingFixture());
  const a = analyse(s);
  const p = {
    id: 'p1',
    version: 1,
    snapshotDigest: s.digest,
    category: 'explained_rounding',
    differenceMinor: '1',
    evidenceRefs: a.requiredRefs,
    calculationIds: a.calculations.map((c) => c.id),
    explanation: 'The policies use different rounding boundaries.',
    nextStep: 'Review',
    modelVersion: 'fake-v1',
    promptVersion: 'v1',
  };
  assert.equal(validateProposal(p, s, a, a.calculations).differenceMinor, '1');
  assert.throws(
    () => validateProposal({ ...p, differenceMinor: '0' }, s, a, a.calculations),
    /INVALID_PROPOSAL/,
  );
  assert.throws(
    () => validateProposal({ ...p, evidenceRefs: [] }, s, a, a.calculations),
    /INVALID_PROPOSAL/,
  );
  const missing = { ...s, policies: [] };
  assert.throws(
    () => validateProposal(p, missing, analyse(missing), a.calculations),
    /INVALID_PROPOSAL/,
  );
});
