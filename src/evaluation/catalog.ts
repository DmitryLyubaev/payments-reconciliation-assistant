import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { idSchema } from '../domain/contracts.js';
import type { FakeScript } from '../investigation/contracts.js';
import { expectedCaseSchema, type ExpectedCase } from './score.js';
const pathSchema = z.string().regex(/^(dev|heldout)\/(data|gold|scripts)\/[A-Za-z0-9_-]+\.json$/);
const manifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  frozenOn: z.string(),
  cases: z.array(
    z.strictObject({
      id: idSchema,
      split: z.enum(['dev', 'heldout']),
      scenario: z.enum(['normal', 'duplicate_import', 'stale_proposal']),
      data: pathSchema,
      gold: pathSchema,
      scripts: pathSchema,
    }),
  ),
  files: z.record(pathSchema, z.string().regex(/^[a-f0-9]{64}$/)),
});
export type EvaluationCase = {
  id: string;
  data: unknown;
  gold: ExpectedCase;
  script: FakeScript;
  scenario: 'normal' | 'duplicate_import' | 'stale_proposal';
};
export type EvaluationCatalog = {
  manifestDigest: string;
  frozenOn: string;
  cases: EvaluationCase[];
};
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
export function loadEvaluationCatalog(root: string, split: 'dev' | 'heldout'): EvaluationCatalog {
  const base = resolve(root),
    manifestBytes = readFileSync(resolve(base, 'manifest.json'));
  const manifest = manifestSchema.parse(JSON.parse(manifestBytes.toString('utf8')));
  if (
    manifest.cases.filter((c) => c.split === 'dev').length !== 4 ||
    manifest.cases.filter((c) => c.split === 'heldout').length !== 12 ||
    new Set(manifest.cases.map((c) => c.id)).size !== 16
  )
    throw new Error('CATALOG_SPLIT');
  const bytes = new Map<string, Buffer>();
  for (const [path, digest] of Object.entries(manifest.files)) {
    const target = resolve(base, path);
    if (!target.startsWith(base + sep)) throw new Error('FIXTURE_PATH');
    const data = readFileSync(target);
    if (sha(data) !== digest) throw new Error('FIXTURE_DIGEST');
    bytes.set(path, data);
  }
  const read = (path: string) => {
    const data = bytes.get(path);
    if (!data) throw new Error('UNFROZEN_FILE');
    return JSON.parse(data.toString('utf8'));
  };
  return {
    manifestDigest: sha(manifestBytes),
    frozenOn: manifest.frozenOn,
    cases: manifest.cases
      .filter((c) => c.split === split)
      .map((c) => {
        for (const path of [c.data, c.gold, c.scripts])
          if (!path.startsWith(c.split + '/')) throw new Error('CATALOG_PATH_SPLIT');
        const data = read(c.data),
          script = read(c.scripts);
        if (
          data.id !== c.id ||
          !script ||
          typeof script.id !== 'string' ||
          typeof script.version !== 'string' ||
          !Array.isArray(script.steps)
        )
          throw new Error('CATALOG_ID');
        return {
          id: c.id,
          data,
          gold: expectedCaseSchema.parse(read(c.gold)),
          script,
          scenario: c.scenario,
        };
      }),
  };
}
