import { resolve } from 'node:path';
import { loadEvaluationCatalog } from './catalog.js';
import { observe, codeIdentity } from './report.js';
import { scoreCase } from './score.js';
import type { WorkflowDeps } from '../workflow/graph.js';
import { LiveBudget, LIVE_PRICES, usdFromNano } from '../investigation/live-budget.js';
type LiveOptions = {
  root: string;
  split: 'dev' | 'heldout';
  passes: number;
  budget: LiveBudget;
  binding: NonNullable<WorkflowDeps['live']>;
  caseId?: string;
  onCase?: (value: unknown) => Promise<void>;
};
export async function runLiveEvaluation(options: LiveOptions) {
  if (!Number.isInteger(options.passes) || options.passes < 1 || options.passes > 3)
    throw new Error('INVALID_PASSES');
  const catalog = loadEvaluationCatalog(options.root, options.split);
  const selected = catalog.cases.filter((c) => !options.caseId || c.id === options.caseId);
  if (!selected.length) throw new Error('INVALID_CASE');
  const before = options.budget.summary();
  const start = performance.now();
  const cases: (Awaited<ReturnType<typeof observe>> & {
    pass: number;
    score: ReturnType<typeof scoreCase>;
    modelCategoryCorrect: boolean | null;
    modelMoneyCorrect: boolean | null;
  })[] = [];
  for (let pass = 1; pass <= options.passes; pass++)
    for (const fixture of selected) {
      const result = await observe(fixture, options.binding);
      const bypass = ['matched', 'import_rejected'].includes(fixture.gold.category);
      const row = {
        ...result,
        pass,
        score: scoreCase(result, fixture.gold),
        modelCategoryCorrect: bypass ? null : result.modelCategory === fixture.gold.category,
        modelMoneyCorrect: bypass
          ? null
          : result.modelDifferenceMinor === fixture.gold.differenceMinor,
      };
      cases.push(row);
      await options.onCase?.(row);
    }
  const budget = options.budget.summary();
  const runCalls = budget.calls.slice(before.calls.length);
  return {
    mode: 'anthropic' as const,
    provider: 'Anthropic',
    model: options.binding.identity.modelVersion,
    promptVersion: options.binding.identity.promptVersion,
    configuration: options.binding.identity,
    generatedAt: new Date().toISOString(),
    prices: LIVE_PRICES,
    ...codeIdentity(resolve(options.root, '..')),
    manifestDigest: catalog.manifestDigest,
    split: options.split,
    passes: options.passes,
    elapsedMs: performance.now() - start,
    passed: cases.filter((c) => c.score.passed).length,
    failed: cases.filter((c) => !c.score.passed).length,
    categoryCorrect: cases.filter((c) => c.score.checks.category).length,
    baselineCorrect: cases.filter((c) => c.score.checks.baselineCategory).length,
    modelCategoryCorrect: cases.filter((c) => c.modelCategoryCorrect === true).length,
    modelInvestigations: cases.filter((c) => c.modelCategoryCorrect !== null).length,
    unsafeTransitions: cases.filter((c) => c.unsafeTransition).length,
    unsettledCalls: budget.unsettledCalls,
    actualSpendUsd: budget.unsettledCalls ? null : usdFromNano(budget.spentNanoUsd),
    measuredSpendUsd: usdFromNano(budget.spentNanoUsd),
    committedUpperBoundUsd: usdFromNano(budget.committedNanoUsd),
    runMeasuredSpendUsd: usdFromNano(
      (BigInt(budget.spentNanoUsd) - BigInt(before.spentNanoUsd)).toString(),
    ),
    runActualSpendUsd: runCalls.some((call) => call.chargedNanoUsd === null)
      ? null
      : usdFromNano((BigInt(budget.spentNanoUsd) - BigInt(before.spentNanoUsd)).toString()),
    budget,
    runCalls,
    cases,
    reviewer: 'automated evaluation harness; no independent human agreement study',
  };
}
