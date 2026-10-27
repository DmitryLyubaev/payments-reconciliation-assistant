import { z } from 'zod';import { randomUUID } from 'node:crypto';
import { idSchema } from '../domain/contracts.js';import { analyse } from '../domain/reconcile.js';
import type { DecisionRequest,Proposal } from '../investigation/contracts.js';import { type Store,digestOf } from '../storage/store.js';import { loadSnapshot } from '../storage/imports.js';import type { AppliedIntent } from './graph.js';
export type FaultPoint='after_intent_commit'|'before_outcome_commit'|'after_outcome_commit_before_checkpoint'|'after_checkpoint_before_intent_mark';
export type FaultHook=(point:FaultPoint)=>void;
export type DecisionReceipt={intentId:string;status:'pending'|'applied'|'invalidated';replayed:boolean};
export type IntentRow={id:string;idempotency_key:string;proposal_id:string;thread_id:string;request_hash:string;payload:string;status:DecisionReceipt['status'];consumed:number};
const requestSchema=z.strictObject({proposalId:idSchema,proposalVersion:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),snapshotDigest:z.string().regex(/^[a-f0-9]{64}$/),idempotencyKey:idSchema,decision:z.enum(['accept','reject','acknowledge'])});
export function recordDecision(store:Store,request:DecisionRequest):DecisionReceipt{
 const parsed=requestSchema.safeParse(request);if(!parsed.success)throw new Error('INVALID_DECISION');const command=parsed.data,hash=digestOf(command);
 return store.transaction(()=>{
  const sameKey=store.db.prepare('SELECT * FROM decision_intents WHERE idempotency_key=?').get(command.idempotencyKey) as IntentRow|undefined;
  if(sameKey){if(sameKey.request_hash!==hash)throw new Error('CONFLICT');return {intentId:sameKey.id,status:sameKey.status,replayed:true};}
  const row=store.db.prepare('SELECT p.payload,i.batch_id,i.receipt_id,i.id AS thread_id FROM proposals p JOIN investigations i ON i.id=p.thread_id WHERE p.id=?').get(command.proposalId) as {payload:string;batch_id:string;receipt_id:string;thread_id:string}|undefined;
  if(!row)throw new Error('NOT_FOUND');const proposal=JSON.parse(row.payload) as Proposal;
  const current=loadSnapshot(store,row.batch_id,row.receipt_id);
  if(command.proposalVersion!==proposal.version||command.snapshotDigest!==proposal.snapshotDigest||current.digest!==proposal.snapshotDigest)throw new Error('STALE');
  const eligible=proposal.category==='explained_rounding'&&analyse(current).eligible;
  if((command.decision==='accept'||command.decision==='reject')&&!eligible||command.decision==='acknowledge'&&eligible)throw new Error('INELIGIBLE');
  if(store.db.prepare('SELECT 1 FROM decision_intents WHERE proposal_id=?').get(proposal.id))throw new Error('CONFLICT');
  const id=randomUUID();store.db.prepare("INSERT INTO decision_intents(id,idempotency_key,proposal_id,thread_id,request_hash,payload,status) VALUES(?,?,?,?,?,?,'pending')").run(id,command.idempotencyKey,proposal.id,row.thread_id,hash,JSON.stringify(command));
  store.audit(row.thread_id,'review_decision',{actor:'demo-reviewer',decision:command.decision,proposalId:proposal.id,version:proposal.version,snapshotDigest:proposal.snapshotDigest},`decision:${proposal.id}`);
  return {intentId:id,status:'pending',replayed:false};
 });
}
export function applyIntent(store:Store,intentId:string,fault?:FaultHook,expectedProposalId?:string):AppliedIntent{
 const applied=store.transaction(()=>{
  const intent=store.db.prepare('SELECT * FROM decision_intents WHERE id=?').get(intentId) as IntentRow|undefined;if(!intent)throw new Error('NOT_FOUND');
  if(expectedProposalId&&intent.proposal_id!==expectedProposalId)throw new Error('INTENT_SCOPE');
  const existing=store.db.prepare('SELECT outcome FROM outcomes WHERE proposal_id=?').get(intent.proposal_id) as {outcome:AppliedIntent['outcome']}|undefined;
  if(existing)return {state:intent.status==='invalidated'?'invalidated':'applied',outcome:existing.outcome,proposalId:intent.proposal_id} as AppliedIntent;
  const request=JSON.parse(intent.payload) as DecisionRequest;
  const investigation=store.db.prepare('SELECT batch_id,receipt_id FROM investigations WHERE id=?').get(intent.thread_id) as {batch_id:string;receipt_id:string};
  const current=loadSnapshot(store,investigation.batch_id,investigation.receipt_id);const invalidated=current.digest!==request.snapshotDigest;
  const outcome:AppliedIntent['outcome']=!invalidated&&request.decision==='accept'?'reviewed_explained':'open_unresolved';
  store.db.prepare('INSERT INTO outcomes(proposal_id,thread_id,snapshot_digest,outcome,applied_at) VALUES(?,?,?,?,?)').run(intent.proposal_id,intent.thread_id,request.snapshotDigest,outcome,new Date().toISOString());
  store.db.prepare('UPDATE decision_intents SET status=? WHERE id=?').run(invalidated?'invalidated':'applied',intentId);
  store.audit(intent.thread_id,'terminal_outcome',{proposalId:intent.proposal_id,outcome,invalidated,snapshotDigest:request.snapshotDigest},`terminal:${intent.proposal_id}`);
  fault?.('before_outcome_commit');return {state:invalidated?'invalidated':'applied',outcome,proposalId:intent.proposal_id} as AppliedIntent;
 });
 fault?.('after_outcome_commit_before_checkpoint');return applied;
}
