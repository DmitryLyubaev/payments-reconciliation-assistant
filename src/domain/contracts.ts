import { z } from 'zod';

export const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const minorSchema = z.string().regex(/^(0|[1-9][0-9]{0,17})$/);
const positiveMinor = minorSchema.refine(value => BigInt(value) > 0n, 'Positive amount required');
const versionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const refSchema = z.strictObject({kind:z.enum(['source','policy']),id:idSchema,version:versionSchema});
const lineSchema = z.strictObject({id:idSchema,netMinor:positiveMinor});
export const sourceSchema = z.strictObject({
  id:idSchema,version:versionSchema,batchId:idSchema,receiptId:idSchema,
  source:z.enum(['pos','accounting']),currency:z.literal('AUD'),basis:z.literal('exclusive'),rateBps:z.literal(1000),
  subtotalMinor:positiveMinor,taxMinor:minorSchema,grossMinor:positiveMinor,
  lines:z.array(lineSchema).min(1).max(100).nullable(),notes:z.string().max(2000).optional()
}).superRefine((source,ctx) => {
  if (source.lines && new Set(source.lines.map(line => line.id)).size !== source.lines.length) ctx.addIssue({code:'custom',message:'Duplicate line ID'});
});
export const policySchema = z.strictObject({
  id:idSchema,version:versionSchema,batchId:idSchema,receiptIds:z.array(idSchema).min(1).max(100),
  source:z.enum(['pos','accounting']),rateBps:z.literal(1000),rounding:z.enum(['per_item','per_receipt']),text:z.string().max(2000)
});
export const fixtureSchema = z.strictObject({schemaVersion:z.literal(1),id:idSchema,sources:z.array(sourceSchema).min(1).max(100),policies:z.array(policySchema).max(100)});
export type Minor = string;
export type Ref = z.infer<typeof refSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type Policy = z.infer<typeof policySchema>;
export type Fixture = z.infer<typeof fixtureSchema>;
export type Category = 'matched'|'explained_rounding'|'insufficient_evidence'|'contradictory_evidence'|'unexplained_mismatch';
export type Snapshot = {batchId:string;receiptId:string;digest:string;sources:Source[];policies:Policy[]};
export type Calculation = {id:string;sourceRef:Ref;rounding:Policy['rounding'];subtotalMinor:Minor;taxMinor:Minor;grossMinor:Minor};
export type Analysis = {category:Category;differenceMinor:string|null;eligible:boolean;requiredRefs:Ref[];missing:string[];calculations:Calculation[]};
export function parseFixture(raw:unknown):Fixture { return fixtureSchema.parse(raw); }
export function sourceRef(source:Source):Ref { return {kind:'source',id:source.id,version:source.version}; }
export function policyRef(policy:Policy):Ref { return {kind:'policy',id:policy.id,version:policy.version}; }
export function refKey(ref:Ref):string { return `${ref.kind}:${ref.id}:${ref.version}`; }
