import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { loadEvaluationCatalog } from '../../src/evaluation/catalog.js';
test('frozen catalogue has four development and twelve disjoint held-out cases', () => {
  const root = resolve('fixtures'),
    dev = loadEvaluationCatalog(root, 'dev'),
    held = loadEvaluationCatalog(root, 'heldout');
  assert.equal(dev.cases.length, 4);
  assert.equal(held.cases.length, 12);
  assert.equal(new Set([...dev.cases, ...held.cases].map((c) => c.id)).size, 16);
  assert.equal(dev.manifestDigest, held.manifestDigest);
  assert.equal(held.cases.find((c) => c.id === 'h03-second-rounding')!.gold.posTotalMinor, '2234');
  assert.equal(
    held.cases.find((c) => c.id === 'h03-second-rounding')!.gold.accountingTotalMinor,
    '2233',
  );
});
test('changing a frozen file is detected before running an evaluation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'payment frozen '));
  try {
    cpSync('fixtures', join(dir, 'fixtures'), { recursive: true });
    const file = join(dir, 'fixtures/heldout/data/h02-rounding.json');
    writeFileSync(file, readFileSync(file, 'utf8') + ' ');
    assert.throws(() => loadEvaluationCatalog(join(dir, 'fixtures'), 'heldout'), /FIXTURE_DIGEST/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
