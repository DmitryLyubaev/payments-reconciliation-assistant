import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
for (const point of [
  'after_intent_commit',
  'before_outcome_commit',
  'after_outcome_commit_before_checkpoint',
  'after_checkpoint_before_intent_mark',
])
  test(`crash recovery at ${point} produces one outcome`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'payment crash '));
    try {
      const child = (phase: string) =>
        spawnSync(
          process.execPath,
          ['--import', 'tsx', 'tests/support/recovery-child.ts', dir, phase, point],
          { encoding: 'utf8', timeout: 20000 },
        );
      const first = child('crash');
      assert.equal(first.status, 73, first.stderr);
      const second = child('recover');
      assert.equal(second.status, 0, second.stderr);
      assert.deepEqual(JSON.parse(second.stdout), {
        outcomes: { n: 1 },
        events: { n: 1 },
        pending: { n: 0 },
      });
      const replay = child('recover');
      assert.equal(replay.status, 0, replay.stderr);
      assert.deepEqual(JSON.parse(replay.stdout), JSON.parse(second.stdout));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
