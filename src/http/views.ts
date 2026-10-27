import { analyse } from '../domain/reconcile.js';import type { Analysis,Ref } from '../domain/contracts.js';import type { Proposal } from '../investigation/contracts.js';import type { Store } from '../storage/store.js';import { loadSnapshot } from '../storage/imports.js';
export type ReviewView={batchId:string;receiptId:string;status:string;category:Analysis['category'];posTotalMinor:string|null;accountingTotalMinor:string|null;differenceMinor:string|null;proposal:Proposal|null;actions:('accept'|'reject'|'acknowledge')[];evidenceRefs:Ref[];outcome:string|null;history:ReturnType<Store['history']>;errorCode?:string};
export function getReviewView(store:Store,batchId:string,receiptId:string):ReviewView{
 const snapshot=loadSnapshot(store,batchId,receiptId),analysis=analyse(snapshot);
 const row=store.db.prepare('SELECT id,status,proposal_id,state_json FROM investigations WHERE batch_id=? AND receipt_id=? AND snapshot_digest=? ORDER BY seq DESC LIMIT 1').get(batchId,receiptId,snapshot.digest) as {id:string;status:string;proposal_id:string|null;state_json:string}|undefined;
 const p=row?.proposal_id?store.db.prepare('SELECT payload FROM proposals WHERE id=?').get(row.proposal_id) as {payload:string}|undefined:undefined;
 const proposal=p?JSON.parse(p.payload) as Proposal:null;
 const outcomeRow=proposal?store.db.prepare('SELECT outcome FROM outcomes WHERE proposal_id=?').get(proposal.id) as {outcome:string}|undefined:undefined;
 const pending=proposal?!!store.db.prepare("SELECT 1 FROM decision_intents WHERE proposal_id=? AND status='pending'").get(proposal.id):false;
 const actions:ReviewView['actions']=row?.status==='awaiting_review'&&!outcomeRow&&!pending?(proposal?.category==='explained_rounding'&&analysis.eligible?['accept','reject']:proposal?['acknowledge']:[]):[];
 const failure=row?JSON.parse(row.state_json).result:undefined;
 return {batchId,receiptId,status:pending?'applying_decision':row?.status??'ready',category:analysis.category,posTotalMinor:snapshot.sources.find(s=>s.source==='pos')?.grossMinor??null,accountingTotalMinor:snapshot.sources.find(s=>s.source==='accounting')?.grossMinor??null,differenceMinor:analysis.differenceMinor,proposal,actions,evidenceRefs:analysis.requiredRefs,outcome:outcomeRow?.outcome??null,history:row?store.history(row.id):[],...(failure?.status==='failed'?{errorCode:failure.code}:{})};
}
