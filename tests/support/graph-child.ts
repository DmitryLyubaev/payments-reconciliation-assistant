import { openStore } from '../../src/storage/store.js';
import { createWorkflow } from '../../src/workflow/graph.js';
import { importFixture, loadSnapshot } from '../../src/storage/imports.js';
import { roundingFixture, roundingScript } from './fixtures.js';
const [dir, phase] = process.argv.slice(2);
const store = openStore(dir);
const workflow = createWorkflow({
  store,
  applyIntent: () => ({
    state: 'applied',
    outcome: 'reviewed_explained',
    proposalId: (store.db.prepare('SELECT id FROM proposals LIMIT 1').get() as { id: string }).id,
  }),
});
try {
  let view;
  if (phase === 'start') {
    const f = roundingFixture();
    importFixture(store, f);
    view = await workflow.start(
      loadSnapshot(store, f.sources[0].batchId, f.sources[0].receiptId),
      roundingScript(f),
    );
  } else {
    const row = store.db.prepare('SELECT id FROM investigations LIMIT 1').get() as { id: string };
    view = await workflow.resume(row.id, 'test-intent');
  }
  const proposal = store.db.prepare('SELECT payload FROM proposals LIMIT 1').get() as {
    payload: string;
  };
  const count = store.db.prepare('SELECT count(*) AS n FROM model_attempts').get() as { n: number };
  console.log(
    JSON.stringify({ view, proposal: JSON.parse(proposal.payload), modelAttempts: count.n }),
  );
} finally {
  await workflow.close();
  store.close();
}
