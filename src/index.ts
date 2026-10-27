import { parseArgs } from 'node:util';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { join, resolve, basename } from 'node:path';
import { openStore } from './storage/store.js';
import { parseFixture } from './domain/contracts.js';
import { createWorkflow } from './workflow/graph.js';
import { applyIntent } from './workflow/decisions.js';
import { startRunner } from './workflow/runner.js';
import { createServer, type DemoFixture } from './http/server.js';
import { requireOfflineMode } from './investigation/fake-model.js';
import type { FakeScript } from './investigation/contracts.js';
import { LiveBudget } from './investigation/live-budget.js';
import { createAnthropicModel } from './investigation/anthropic-model.js';
import { LIVE_IDENTITY } from './investigation/live-config.js';
const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '4313' },
    'data-dir': { type: 'string', default: 'data' },
    mode: { type: 'string', default: 'fake' },
  },
});
if (values.mode !== 'anthropic') requireOfflineMode(values.mode);
const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('INVALID_PORT');
const root = fileURLToPath(new URL('../', import.meta.url));
let budget: LiveBudget | undefined;
let live;
if (values.mode === 'anthropic') {
  if (existsSync(join(root, '.env'))) loadEnvFile(join(root, '.env'));
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_KEY_REQUIRED');
  budget = new LiveBudget(join(root, 'data/llm-budget.sqlite'));
  live = {
    identity: LIVE_IDENTITY,
    adapter: createAnthropicModel({ apiKey: process.env.ANTHROPIC_API_KEY, budget }),
  };
}
const names: Record<string, string> = {
  rounding: 'GST rounding',
  'missing-policy': 'Missing evidence',
  unexplained: 'Unexplained mismatch',
  matched: 'Exact match',
};
const fixtures: DemoFixture[] = readdirSync(join(root, 'fixtures/dev/data'))
  .filter((f) => f.endsWith('.json'))
  .map((file) => {
    const slug = basename(file, '.json');
    const data = parseFixture(
      JSON.parse(readFileSync(join(root, 'fixtures/dev/data', file), 'utf8')),
    );
    return {
      id: data.id,
      label: names[slug] ?? slug,
      data,
      script: JSON.parse(
        readFileSync(join(root, 'fixtures/dev/scripts', file), 'utf8'),
      ) as FakeScript,
    };
  });
const store = openStore(resolve(values['data-dir']));
const workflow = createWorkflow({
  store,
  live,
  applyIntent: (id, expected) => applyIntent(store, id, undefined, expected),
});
const runner = startRunner({ store, workflow });
await runner.wake();
const server = await createServer({
  store,
  workflow,
  runner,
  fixtures,
  port,
  runtimeMode: live ? 'anthropic' : 'fake/scripted',
  modelVersion: live?.identity.modelVersion,
});
console.log(
  `Payments reconciliation: ${server.origin} (${live ? LIVE_IDENTITY.modelVersion : 'fake/scripted'} mode)`,
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await server.close();
  await runner.close();
  await workflow.close();
  store.close();
  budget?.close();
  process.exitCode = 0;
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
