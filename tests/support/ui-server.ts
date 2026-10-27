import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { openStore } from '../../src/storage/store.js';
import { createWorkflow } from '../../src/workflow/graph.js';
import { applyIntent } from '../../src/workflow/decisions.js';
import { startRunner } from '../../src/workflow/runner.js';
import { createServer } from '../../src/http/server.js';
import { roundingFixture, roundingScript, outcomeScript } from './fixtures.js';
const store = openStore(mkdtempSync(join(tmpdir(), 'payment browser ')));
const workflow = createWorkflow({
  store,
  applyIntent: (id, expected) => applyIntent(store, id, undefined, expected),
});
const runner = startRunner({ store, workflow });
const rounding = roundingFixture('dev-rounding');
const missing = roundingFixture('dev-missing-policy');
missing.policies = [];
missing.sources[0].notes = '<script>window.__injected=1</script>';
const server = await createServer({
  store,
  workflow,
  runner,
  port: 4314,
  assetDir: resolve('dist/ui'),
  fixtures: [
    { id: rounding.id, label: 'GST rounding', data: rounding, script: roundingScript(rounding) },
    {
      id: missing.id,
      label: 'Missing evidence',
      data: missing,
      script: outcomeScript(missing, 'insufficient_evidence', '1'),
    },
  ],
});
console.log(server.origin);
const close = async () => {
  await server.close();
  await runner.close();
  await workflow.close();
  store.close();
  process.exit(0);
};
process.on('SIGTERM', () => void close());
process.on('SIGINT', () => void close());
