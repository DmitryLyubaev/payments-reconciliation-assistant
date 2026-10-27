import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { type Fixture, type Snapshot } from '../domain/contracts.js';
import { baseline } from '../investigation/baseline.js';
import { requireOfflineMode } from '../investigation/fake-model.js';
import type { Proposal, DecisionRequest } from '../investigation/contracts.js';
import { openStore } from '../storage/store.js';
import { importFixture, loadSnapshot } from '../storage/imports.js';
import { createWorkflow } from '../workflow/graph.js';
import { recordDecision, applyIntent } from '../workflow/decisions.js';
import { recoverPending } from '../workflow/runner.js';
import { loadEvaluationCatalog, type EvaluationCase } from './catalog.js';
import { scoreCase, type ObservedCase, type CaseScore } from './score.js';
export type EvaluationOptions = { root: string; split: 'dev' | 'heldout'; mode?: string };
export type EvaluationReport = {
  mode: 'fake/scripted';
  modelSpend: 'not incurred';
  liveModelMetrics: null;
  generatedAt: string;
  manifestDigest: string;
  promptVersion: string;
  codeVersion: string;
  sourceDigest: string;
  workingTreeDirty: boolean;
  split: string;
  elapsedMs: number;
  passed: number;
  failed: number;
  cases: (ObservedCase & { score: CaseScore })[];
  processCrashRecovery: { runByEvaluator: false; command: string };
};
async function observe(c: EvaluationCase): Promise<ObservedCase> {
  const start = performance.now();
  const prefix = join(tmpdir(), 'payment-eval-'),
    dir = mkdtempSync(prefix),
    store = openStore(dir);
  const workflow = createWorkflow({
    store,
    applyIntent: (id, expected) => applyIntent(store, id, undefined, expected),
  });
  const result: ObservedCase = {
    id: c.id,
    category: 'failed',
    baselineCategory: 'failed',
    differenceMinor: null,
    posTotalMinor: null,
    accountingTotalMinor: null,
    evidenceRefs: [],
    outcome: 'open_unresolved',
    sourcePreserved: true,
    unsafeTransition: false,
    staleRejected: false,
    duplicateReplayed: false,
    terminalCount: 0,
    modelCalls: 0,
    toolCalls: 0,
    elapsedMs: 0,
  };
  try {
    const imported = importFixture(store, c.data);
    if (imported.status === 'rejected') {
      result.category = 'import_rejected';
      result.baselineCategory = 'import_rejected';
      result.outcome = 'import_rejected';
      return result;
    }
    const f = c.data as Fixture,
      s = f.sources[0];
    const snapshot = loadSnapshot(store, s.batchId, s.receiptId);
    const baseStart = performance.now(),
      analysis = baseline(snapshot);
    result.baselineElapsedMs = performance.now() - baseStart;
    result.baselineCategory = analysis.category;
    result.differenceMinor = analysis.differenceMinor;
    if (c.scenario === 'duplicate_import')
      result.duplicateReplayed = importFixture(store, c.data).status === 'replayed';
    const view = await workflow.start(snapshot, c.script);
    result.category = view.status === 'matched' ? 'matched' : 'failed';
    if (view.status === 'matched') {
      result.outcome = 'matched';
      result.evidenceRefs = analysis.requiredRefs;
    } else if (view.proposalId) {
      const proposal = JSON.parse(
        (
          store.db.prepare('SELECT payload FROM proposals WHERE id=?').get(view.proposalId) as {
            payload: string;
          }
        ).payload,
      ) as Proposal;
      result.category = proposal.category;
      result.evidenceRefs = proposal.evidenceRefs;
      result.differenceMinor = proposal.differenceMinor;
      const command: DecisionRequest = {
        proposalId: proposal.id,
        proposalVersion: proposal.version,
        snapshotDigest: proposal.snapshotDigest,
        idempotencyKey: 'evaluation-review',
        decision: proposal.category === 'explained_rounding' ? 'accept' : 'acknowledge',
      };
      recordDecision(store, command);
      if (c.scenario === 'stale_proposal') {
        const changed = structuredClone(f);
        changed.sources[0].version++;
        changed.sources[0].notes = 'New independently versioned evidence.';
        importFixture(store, changed);
        try {
          recordDecision(store, { ...command, idempotencyKey: 'stale-retry' });
        } catch (error) {
          result.staleRejected = error instanceof Error && error.message === 'STALE';
        }
      }
      await recoverPending({ store, workflow });
      await recoverPending({ store, workflow });
      const outcome = store.db
        .prepare('SELECT outcome FROM outcomes WHERE proposal_id=?')
        .get(proposal.id) as { outcome: string } | undefined;
      result.outcome = outcome?.outcome ?? 'open_unresolved';
      const current = loadSnapshot(store, s.batchId, s.receiptId);
      result.unsafeTransition =
        result.outcome === 'reviewed_explained' &&
        (!analysis.eligible || current.digest !== proposal.snapshotDigest);
    }
    const final = loadSnapshot(store, s.batchId, s.receiptId);
    result.posTotalMinor = final.sources.find((v) => v.source === 'pos')?.grossMinor ?? null;
    result.accountingTotalMinor =
      final.sources.find((v) => v.source === 'accounting')?.grossMinor ?? null;
    result.sourcePreserved = f.sources.every((source) => {
      const row = store.db
        .prepare('SELECT payload FROM source_versions WHERE id=? AND version=?')
        .get(source.id, source.version) as { payload: string } | undefined;
      return !!row && isDeepStrictEqual(JSON.parse(row.payload), source);
    });
  } catch (error) {
    result.category = 'failed';
    result.errorCode = error instanceof Error ? error.message.slice(0, 100) : 'EVALUATION_FAILED';
  } finally {
    result.modelCalls = (
      store.db.prepare('SELECT count(*) AS n FROM model_attempts').get() as { n: number }
    ).n;
    result.toolCalls = (
      store.db.prepare('SELECT count(*) AS n FROM tool_results').get() as { n: number }
    ).n;
    result.terminalCount = (
      store.db.prepare('SELECT count(*) AS n FROM outcomes').get() as { n: number }
    ).n;
    await workflow.close();
    store.close();
    result.elapsedMs = performance.now() - start;
    if (!resolve(dir).startsWith(resolve(prefix))) throw new Error('UNSAFE_TEMP_PATH');
    rmSync(dir, { recursive: true, force: true });
  }
  return result;
}
function codeIdentity(root: string) {
  let codeVersion = 'unversioned-source',
    workingTreeDirty = true;
  try {
    codeVersion = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    workingTreeDirty = !!execFileSync('git', ['status', '--porcelain'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
  } catch {}
  const hash = createHash('sha256');
  const walk = (relative: string) => {
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(relative, entry.name);
      if (entry.isDirectory()) walk(path);
      else {
        hash.update(path.replaceAll('\\', '/'));
        hash.update(readFileSync(join(root, path)));
      }
    }
  };
  for (const dir of ['src', 'scripts']) walk(dir);
  for (const file of ['package.json', 'package-lock.json', '.node-version']) {
    hash.update(file);
    hash.update(readFileSync(join(root, file)));
  }
  return { codeVersion, workingTreeDirty, sourceDigest: hash.digest('hex') };
}
export async function runOfflineEvaluation(options: EvaluationOptions): Promise<EvaluationReport> {
  requireOfflineMode(options.mode ?? 'fake');
  const start = performance.now(),
    catalog = loadEvaluationCatalog(options.root, options.split),
    cases: EvaluationReport['cases'] = [];
  for (const c of catalog.cases) {
    const result = await observe(c);
    cases.push({ ...result, score: scoreCase(result, c.gold) });
  }
  return {
    mode: 'fake/scripted',
    modelSpend: 'not incurred',
    liveModelMetrics: null,
    generatedAt: new Date().toISOString(),
    manifestDigest: catalog.manifestDigest,
    promptVersion: 'rounding-investigation-v1',
    ...codeIdentity(resolve(options.root, '..')),
    split: options.split,
    elapsedMs: performance.now() - start,
    passed: cases.filter((c) => c.score.passed).length,
    failed: cases.filter((c) => !c.score.passed).length,
    cases,
    processCrashRecovery: { runByEvaluator: false, command: 'npm test' },
  };
}
export async function writeReport(report: EvaluationReport, outputDir: string): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  const rows = report.cases
    .map(
      (c) =>
        `| ${c.id} | ${c.category} | ${c.score.passed ? 'pass' : 'FAIL'} | ${c.modelCalls} | ${c.toolCalls} |`,
    )
    .join('\n');
  await writeFile(
    join(outputDir, 'report.md'),
    `# Offline workflow contract checks\n\nGenerated: ${report.generatedAt}\n\nMode: fake/scripted. Model spend: not incurred. Live model metrics: unavailable.\n\n${report.passed}/${report.cases.length} cases passed. This measures workflow contracts with authored scripted replies, not AI quality.\n\nManifest: ${report.manifestDigest}\nCode: ${report.codeVersion}; dirty tree: ${report.workingTreeDirty}\nSource digest: ${report.sourceDigest}\nElapsed: ${report.elapsedMs.toFixed(1)} ms\n\n| Case | Result category | Contract checks | Scripted adapter attempts | Tool calls |\n|---|---|---|---:|---:|\n${rows}\n\nProcess-crash recovery is checked separately by npm test, not by this evaluator command. Inspect report.json for per-case checks and failures.\n`,
  );
}
