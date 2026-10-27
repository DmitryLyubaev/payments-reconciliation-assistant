import { Annotation,StateGraph,START,END,interrupt,Command } from '@langchain/langgraph';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';import { join } from 'node:path';
import { type Store,digestOf } from '../storage/store.js';
import { analyse } from '../domain/reconcile.js';import type { Snapshot } from '../domain/contracts.js';
import { initialInvestigationState,stepInvestigation } from '../investigation/loop.js';
import { createTools } from '../investigation/tools.js';import { createFakeModel } from '../investigation/fake-model.js';
import type { FakeScript,InvestigationState } from '../investigation/contracts.js';
export type AppliedIntent={state:'applied'|'invalidated';outcome:'reviewed_explained'|'open_unresolved';proposalId:string};
export type WorkflowView={threadId:string;status:'matched'|'investigating'|'awaiting_review'|'open_unresolved'|'failed'|'completed';proposalId?:string};
export type WorkflowDeps={store:Store;applyIntent:(intentId:string)=>AppliedIntent|Promise<AppliedIntent>;scriptResolver?:(id:string)=>FakeScript};
export interface Workflow{start(snapshot:Snapshot,script:FakeScript):Promise<WorkflowView>;resume(threadId:string,intentId:string):Promise<WorkflowView>;recover(threadId:string):Promise<WorkflowView>;close():Promise<void>}
type InvestigationRow={id:string;snapshot_json:string;script_json:string;script_digest:string;state_json:string;status:WorkflowView['status'];proposal_id:string|null};
export function createWorkflow(deps:WorkflowDeps):Workflow{
 const {store}=deps;const db=new Database(join(store.dataDir,'checkpoints.sqlite'));db.pragma('busy_timeout = 5000');
 const saver=new SqliteSaver(db);const locks=new Map<string,Promise<unknown>>();
 const read=(id:string):InvestigationRow=>{const row=store.db.prepare('SELECT * FROM investigations WHERE id=?').get(id) as InvestigationRow|undefined;if(!row)throw new Error('NOT_FOUND');return row;};
 const view=(id:string):WorkflowView=>{const row=read(id);return {threadId:id,status:row.status,...(row.proposal_id?{proposalId:row.proposal_id}:{})};};
 const config=(id:string)=>({configurable:{thread_id:id},recursionLimit:30});
 const stateSchema=Annotation.Root({flow:Annotation<InvestigationState>,intentId:Annotation<string>});
 const graph=new StateGraph(stateSchema)
  .addNode('precheck',s=>{const snapshot=JSON.parse(read(s.flow.threadId).snapshot_json) as Snapshot;if(analyse(snapshot).category==='matched')store.db.prepare("UPDATE investigations SET status='matched' WHERE id=?").run(s.flow.threadId);return {};})
  .addNode('investigate',async s=>{
   const row=read(s.flow.threadId);const snapshot=JSON.parse(row.snapshot_json) as Snapshot;const script=JSON.parse(row.script_json) as FakeScript;
   let flow:InvestigationState;
   if(deps.scriptResolver&&digestOf(deps.scriptResolver(script.id))!==row.script_digest)flow={...s.flow,result:{status:'failed',code:'SCRIPT_CHANGED'}};
   else flow=await stepInvestigation({store,snapshot,analysis:analyse(snapshot),tools:createTools(store,snapshot),model:createFakeModel(script)},s.flow);
   store.db.prepare('UPDATE investigations SET state_json=?,status=? WHERE id=?').run(JSON.stringify(flow),flow.result?.status==='failed'?'failed':'investigating',flow.threadId);
   if(flow.result?.status==='failed')store.audit(flow.threadId,'investigation_failed',{code:flow.result.code},`failed:${flow.threadId}`);
   return {flow};
  })
  .addNode('persist',s=>{
   if(s.flow.result?.status!=='proposal')throw new Error('INVALID_GRAPH_STATE');const p=s.flow.result.proposal;
   store.transaction(()=>{
    const existing=store.db.prepare('SELECT payload FROM proposals WHERE thread_id=?').get(s.flow.threadId) as {payload:string}|undefined;
    if(existing&&digestOf(JSON.parse(existing.payload))!==digestOf(p))throw new Error('PROPOSAL_CONFLICT');
    store.db.prepare('INSERT OR IGNORE INTO proposals(id,version,thread_id,snapshot_digest,payload) VALUES(?,?,?,?,?)').run(p.id,p.version,s.flow.threadId,p.snapshotDigest,JSON.stringify(p));
    store.db.prepare("UPDATE investigations SET status='awaiting_review',proposal_id=? WHERE id=?").run(p.id,s.flow.threadId);
    store.audit(s.flow.threadId,'proposal_saved',{proposalId:p.id,version:p.version,snapshotDigest:p.snapshotDigest},`proposal:${p.id}:${p.version}`);
   });return {};
  })
  .addNode('review',s=>({intentId:interrupt({proposalId:s.flow.result?.status==='proposal'?s.flow.result.proposal.id:null,snapshotDigest:s.flow.snapshotDigest}) as string}))
  .addNode('apply',async s=>{const applied=await deps.applyIntent(s.intentId);store.db.prepare('UPDATE investigations SET status=? WHERE id=?').run(applied.state==='invalidated'?'open_unresolved':'completed',s.flow.threadId);return {};})
  .addEdge(START,'precheck').addConditionalEdges('precheck',s=>read(s.flow.threadId).status==='matched'?END:'investigate')
  .addConditionalEdges('investigate',s=>!s.flow.result?'investigate':s.flow.result.status==='proposal'?'persist':END)
  .addEdge('persist','review').addEdge('review','apply').addEdge('apply',END).compile({checkpointer:saver});
 const serial=<T>(id:string,fn:()=>Promise<T>):Promise<T>=>{const previous=locks.get(id)??Promise.resolve();const next=previous.catch(()=>{}).then(fn);locks.set(id,next);void next.finally(()=>{if(locks.get(id)===next)locks.delete(id);}).catch(()=>{});return next;};
 const execute=async(id:string,input:Parameters<typeof graph.invoke>[0])=>{try{await graph.invoke(input,config(id));}catch(error){store.db.prepare("UPDATE investigations SET status='failed' WHERE id=?").run(id);store.audit(id,'workflow_failed',{code:error instanceof Error?error.name:'ERROR'});throw error;}return view(id);};
 return {
  async start(snapshot,script){
   const scriptDigest=digestOf(script);const existing=store.db.prepare("SELECT id FROM investigations WHERE snapshot_digest=? AND script_digest=? AND status<>'failed' ORDER BY seq DESC LIMIT 1").get(snapshot.digest,scriptDigest) as {id:string}|undefined;
   if(existing)return serial(existing.id,async()=>view(existing.id));
   const id=randomUUID();const flow=initialInvestigationState(id,snapshot);
   store.db.prepare("INSERT INTO investigations(id,batch_id,receipt_id,snapshot_digest,snapshot_json,state_json,script_json,script_digest,status) VALUES(?,?,?,?,?,?,?,?,'investigating')").run(id,snapshot.batchId,snapshot.receiptId,snapshot.digest,JSON.stringify(snapshot),JSON.stringify(flow),JSON.stringify(script),scriptDigest);
   return serial(id,()=>execute(id,{flow}));
  },
  resume(id,intentId){return serial(id,async()=>{
   let checkpoint=await graph.getState(config(id));
   if(checkpoint.next.length&&!checkpoint.tasks.some(t=>t.interrupts?.length)){await execute(id,null);checkpoint=await graph.getState(config(id));}
   if(checkpoint.tasks.some(t=>t.interrupts?.length))return execute(id,new Command({resume:intentId}));return view(id);
  });},
  recover(id){return serial(id,async()=>{const checkpoint=await graph.getState(config(id));if(checkpoint.tasks.some(t=>t.interrupts?.length))return view(id);if(checkpoint.next.length)return execute(id,null);const row=read(id);if(!checkpoint.values||!Object.keys(checkpoint.values).length)return execute(id,{flow:JSON.parse(row.state_json)});return view(id);});},
  async close(){await Promise.allSettled([...locks.values()]);if(db.open)db.close();}
 };
}
