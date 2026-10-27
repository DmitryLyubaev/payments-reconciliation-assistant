import { z } from 'zod';
import { idSchema,refSchema,refKey,type Snapshot,type Analysis,type Calculation } from '../domain/contracts.js';
import type { Proposal } from './contracts.js';
const schema=z.strictObject({id:idSchema,version:z.number().int().positive(),snapshotDigest:z.string(),category:z.enum(['explained_rounding','insufficient_evidence','contradictory_evidence','unexplained_mismatch']),differenceMinor:z.string().regex(/^(0|-?[1-9][0-9]{0,17})$/).nullable(),evidenceRefs:z.array(refSchema).max(200),calculationIds:z.array(z.string()).max(200),explanation:z.string().min(1).max(4000),nextStep:z.string().min(1).max(1000),modelVersion:z.string().min(1).max(100),promptVersion:z.string().min(1).max(100)});
export function validateProposal(candidate:unknown,snapshot:Snapshot,analysis:Analysis,calculations:Calculation[]):Proposal{
 try{
  const p=schema.parse(candidate);const refs=new Set(p.evidenceRefs.map(refKey));const required=new Set(analysis.requiredRefs.map(refKey));
  if(p.snapshotDigest!==snapshot.digest||p.differenceMinor!==analysis.differenceMinor||p.category!==analysis.category||refs.size!==p.evidenceRefs.length||refs.size!==required.size||[...refs].some(r=>!required.has(r)))throw new Error();
  const available=new Set(calculations.map(c=>c.id));if(p.calculationIds.some(id=>!available.has(id)))throw new Error();
  if(p.category==='explained_rounding')for(const source of snapshot.sources){const policy=snapshot.policies.find(p=>p.source===source.source)!;const calc=calculations.find(c=>c.sourceRef.id===source.id&&c.sourceRef.version===source.version&&c.rounding===policy.rounding&&p.calculationIds.includes(c.id));if(!calc||calc.grossMinor!==source.grossMinor||calc.taxMinor!==source.taxMinor)throw new Error();}
  return p;
 }catch{throw new Error('INVALID_PROPOSAL');}
}
