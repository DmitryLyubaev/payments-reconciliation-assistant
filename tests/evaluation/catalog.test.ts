import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { loadEvaluationCatalog } from '../../src/evaluation/catalog.js';

test('Git checkout preserves frozen fixture bytes with Windows autocrlf enabled', () => {
  const dir = mkdtempSync(join(tmpdir(), 'payment checkout '));
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });
  try {
    git('init');
    cpSync('fixtures', join(dir, 'fixtures'), { recursive: true });
    if (existsSync('.gitattributes')) cpSync('.gitattributes', join(dir, '.gitattributes'));
    git('-c', 'core.autocrlf=false', 'add', '.');
    rmSync(join(dir, 'fixtures'), { recursive: true });
    git('-c', 'core.autocrlf=true', 'checkout-index', '--all', '--force');
    const held = loadEvaluationCatalog(join(dir, 'fixtures'), 'heldout');
    assert.equal(held.cases.length, 12);
    assert.equal(
      held.manifestDigest,
      '25b6b4ce7529ea641c4fb114c81680e2f88a026397a8c732d48aa7a13bc58815',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
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
