import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { runOfflineEvaluation, writeReport } from '../src/evaluation/report.js';
import { requireOfflineMode } from '../src/investigation/fake-model.js';
const { values } = parseArgs({
  options: {
    mode: { type: 'string', default: 'fake' },
    split: { type: 'string', default: 'heldout' },
    output: { type: 'string' },
  },
});
requireOfflineMode(values.mode);
if (values.split !== 'dev' && values.split !== 'heldout') throw new Error('INVALID_SPLIT');
const output = values.output ?? `results/${new Date().toISOString().replaceAll(/[:.]/g, '-')}`;
const report = await runOfflineEvaluation({
  root: resolve('fixtures'),
  split: values.split,
  mode: values.mode,
});
await writeReport(report, output);
console.log(
  JSON.stringify({
    mode: report.mode,
    passed: report.passed,
    total: report.cases.length,
    failed: report.failed,
    elapsedMs: report.elapsedMs,
    modelSpend: report.modelSpend,
    output,
  }),
);
if (report.failed) process.exitCode = 1;
