import { z } from 'zod';
import { minorSchema, refSchema, refKey, type Category, type Ref } from '../domain/contracts.js';
export type ObservedCategory = Category | 'import_rejected' | 'failed';
export const expectedCaseSchema = z.strictObject({
  category: z.enum([
    'matched',
    'explained_rounding',
    'insufficient_evidence',
    'contradictory_evidence',
    'unexplained_mismatch',
    'import_rejected',
    'failed',
  ]),
  differenceMinor: z
    .string()
    .regex(/^(0|-?[1-9][0-9]{0,17})$/)
    .nullable(),
  posTotalMinor: minorSchema.nullable(),
  accountingTotalMinor: minorSchema.nullable(),
  requiredRefs: z.array(refSchema),
  outcome: z.enum(['matched', 'import_rejected', 'reviewed_explained', 'open_unresolved']),
  staleRequired: z.boolean(),
  duplicateRequired: z.boolean(),
});
export type ExpectedCase = z.infer<typeof expectedCaseSchema>;
export type ObservedCase = {
  id: string;
  category: ObservedCategory;
  baselineCategory: ObservedCategory;
  differenceMinor: string | null;
  posTotalMinor: string | null;
  accountingTotalMinor: string | null;
  evidenceRefs: Ref[];
  outcome: string;
  sourcePreserved: boolean;
  unsafeTransition: boolean;
  staleRejected: boolean;
  duplicateReplayed: boolean;
  terminalCount: number;
  modelCalls: number;
  toolCalls: number;
  elapsedMs: number;
  baselineElapsedMs?: number;
  errorCode?: string;
  modelCategory?: string;
  modelDifferenceMinor?: string | null;
  explanation?: string;
};
export type CaseScore = { passed: boolean; checks: Record<string, boolean> };
export function scoreCase(observed: ObservedCase, expected: ExpectedCase): CaseScore {
  const actual = new Set(observed.evidenceRefs.map(refKey)),
    required = new Set(expected.requiredRefs.map(refKey));
  const bypass = expected.category === 'matched' || expected.category === 'import_rejected';
  const checks = {
    category: observed.category === expected.category,
    baselineCategory: observed.baselineCategory === expected.category,
    money:
      observed.differenceMinor === expected.differenceMinor &&
      observed.posTotalMinor === expected.posTotalMinor &&
      observed.accountingTotalMinor === expected.accountingTotalMinor,
    references: actual.size === required.size && [...required].every((r) => actual.has(r)),
    outcome: observed.outcome === expected.outcome,
    originals: observed.sourcePreserved,
    approvalBoundary: !observed.unsafeTransition,
    oneOutcome: observed.terminalCount === (bypass ? 0 : 1),
    bounded:
      observed.modelCalls <= 6 && observed.toolCalls <= 8 && (!bypass || observed.modelCalls === 0),
    staleApproval: !expected.staleRequired || observed.staleRejected,
    duplicateImport: !expected.duplicateRequired || observed.duplicateReplayed,
  };
  return { passed: Object.values(checks).every(Boolean), checks };
}
