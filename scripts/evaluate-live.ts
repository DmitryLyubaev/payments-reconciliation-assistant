import { parseArgs } from 'node:util';
import { existsSync } from 'node:fs';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { loadEnvFile } from 'node:process';
import { LiveBudget } from '../src/investigation/live-budget.js';
import { createAnthropicModel } from '../src/investigation/anthropic-model.js';
import { LIVE_IDENTITY } from '../src/investigation/live-config.js';
import { runLiveEvaluation } from '../src/evaluation/live-report.js';
const { values } = parseArgs({
  options: {
    split: { type: 'string', default: 'heldout' },
    passes: { type: 'string', default: '3' },
    case: { type: 'string' },
    output: { type: 'string' },
  },
});
if (values.split !== 'dev' && values.split !== 'heldout') throw new Error('INVALID_SPLIT');
if (existsSync('.env')) loadEnvFile('.env');
if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_KEY_REQUIRED');
const budget = new LiveBudget(resolve('data/llm-budget.sqlite'));
try {
  const output =
    values.output ?? `results/live-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`;
  await mkdir(output, { recursive: true });
  await writeFile(
    join(output, 'run.json'),
    JSON.stringify({ configuration: LIVE_IDENTITY, budgetBefore: budget.summary() }, null, 2),
    { flag: 'wx' },
  );
  const report = await runLiveEvaluation({
    root: resolve('fixtures'),
    split: values.split,
    passes: Number(values.passes),
    caseId: values.case,
    budget,
    binding: {
      identity: LIVE_IDENTITY,
      adapter: createAnthropicModel({ apiKey: process.env.ANTHROPIC_API_KEY, budget }),
    },
    onCase: async (value) => {
      await appendFile(join(output, 'cases.jsonl'), JSON.stringify(value) + '\n');
      const c = value as {
        id: string;
        pass: number;
        category: string;
        score: { passed: boolean };
        errorCode?: string;
      };
      console.log(
        JSON.stringify({
          case: c.id,
          pass: c.pass,
          category: c.category,
          passed: c.score.passed,
          errorCode: c.errorCode,
        }),
      );
    },
  });
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify({
      mode: report.mode,
      model: report.model,
      passed: report.passed,
      total: report.cases.length,
      failed: report.failed,
      actualSpendUsd: report.actualSpendUsd,
      committedUpperBoundUsd: report.committedUpperBoundUsd,
      output,
    }),
  );
  if (report.failed) process.exitCode = 1;
} finally {
  budget.close();
}
