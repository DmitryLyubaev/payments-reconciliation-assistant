import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('a separate process resumes the same persisted review without further model attempts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'payment restart '));
  try {
    const run = (phase: string) =>
      JSON.parse(
        execFileSync(
          process.execPath,
          ['--import', 'tsx', 'tests/support/graph-child.ts', dir, phase],
          { encoding: 'utf8', timeout: 20000 },
        ),
      );
    const before = run('start'),
      after = run('resume');
    assert.equal(before.view.status, 'awaiting_review');
    assert.equal(after.view.status, 'completed');
    assert.equal(after.view.proposalId, before.view.proposalId);
    assert.deepEqual(after.proposal, before.proposal);
    assert.equal(after.modelAttempts, before.modelAttempts);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
