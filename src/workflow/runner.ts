import type { Store } from '../storage/store.js';
import type { Workflow } from './graph.js';
import type { FaultHook, IntentRow } from './decisions.js';
export type RunnerDeps = { store: Store; workflow: Workflow; fault?: FaultHook };
export type RecoverySummary = {
  scanned: number;
  applied: number;
  invalidated: number;
  alreadyApplied: number;
  failed: number;
};
export interface Runner {
  wake(): Promise<RecoverySummary>;
  close(): Promise<void>;
}
export async function recoverPending({
  store,
  workflow,
  fault,
}: RunnerDeps): Promise<RecoverySummary> {
  const summary: RecoverySummary = {
    scanned: 0,
    applied: 0,
    invalidated: 0,
    alreadyApplied: 0,
    failed: 0,
  };
  const active = store.db
    .prepare(
      "SELECT id FROM investigations WHERE status IN ('investigating','awaiting_review') ORDER BY seq",
    )
    .all() as { id: string }[];
  for (const row of active)
    try {
      await workflow.recover(row.id);
    } catch {
      summary.failed++;
      store.audit(row.id, 'recovery_failed', { stage: 'investigation' });
    }
  const intents = store.db
    .prepare('SELECT * FROM decision_intents WHERE consumed=0 ORDER BY rowid')
    .all() as IntentRow[];
  for (const intent of intents) {
    summary.scanned++;
    try {
      fault?.('after_intent_commit');
      await workflow.resume(intent.thread_id, intent.id);
      fault?.('after_checkpoint_before_intent_mark');
      const current = store.db
        .prepare('SELECT status FROM decision_intents WHERE id=?')
        .get(intent.id) as { status: string };
      if (current.status === 'pending') throw new Error('OUTCOME_NOT_APPLIED');
      store.db.prepare('UPDATE decision_intents SET consumed=1 WHERE id=?').run(intent.id);
      if (current.status === 'invalidated') summary.invalidated++;
      else if (intent.status === 'applied') summary.alreadyApplied++;
      else summary.applied++;
    } catch {
      summary.failed++;
      store.audit(intent.thread_id, 'recovery_failed', { stage: 'decision', intentId: intent.id });
    }
  }
  return summary;
}
export function startRunner(deps: RunnerDeps): Runner {
  let closed = false;
  let queue: Promise<unknown> = Promise.resolve();
  return {
    wake() {
      if (closed) return Promise.reject(new Error('RUNNER_CLOSED'));
      const next = queue.catch(() => {}).then(() => recoverPending(deps));
      queue = next;
      return next;
    },
    async close() {
      closed = true;
      await queue.catch(() => {});
    },
  };
}
