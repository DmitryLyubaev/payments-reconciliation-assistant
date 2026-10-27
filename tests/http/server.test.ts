import { test } from 'node:test';import assert from 'node:assert/strict';import { request } from 'node:http';
import { createServer } from '../../src/http/server.js';import { createWorkflow } from '../../src/workflow/graph.js';import { startRunner } from '../../src/workflow/runner.js';import { applyIntent } from '../../src/workflow/decisions.js';import { tempStore } from '../support/temp-store.js';import { roundingFixture,roundingScript } from '../support/fixtures.js';
async function setup(){const t=tempStore();const workflow=createWorkflow({store:t.store,applyIntent:(id,expected)=>applyIntent(t.store,id,undefined,expected)});const runner=startRunner({store:t.store,workflow});const f=roundingFixture('dev-rounding');const server=await createServer({store:t.store,workflow,runner,fixtures:[{id:f.id,label:'GST rounding',data:f,script:roundingScript(f)}],port:0});const token=(await(await fetch(server.origin+'/api/session')).json()).token;const post=(path:string,body:unknown,extra:Record<string,string>={})=>fetch(server.origin+path,{method:'POST',headers:{'content-type':'application/json','x-session-token':token,...extra},body:JSON.stringify(body)});return {...t,server,workflow,runner,post,token,f,async finish(){await server.close();await runner.close();await workflow.close();t.close();}};}
test('session, origin and host checks protect mutations',async()=>{
 const t=await setup();try{
 assert.equal((await t.post('/api/imports',{fixtureId:t.f.id},{'x-session-token':'wrong'})).status,403);
 assert.equal((await t.post('/api/imports',{fixtureId:t.f.id},{origin:'https://foreign.example'})).status,403);
 const status=await new Promise<number>((resolve,reject)=>{const req=request(t.server.origin+'/api/imports',{method:'POST',headers:{Host:'foreign.example','x-session-token':t.token}},res=>{res.resume();resolve(res.statusCode!);});req.on('error',reject);req.end('{}');});assert.equal(status,403);
 }finally{await t.finish();}
});
test('bounded JSON and explicit routes reject invalid requests without stopping server',async()=>{
 const t=await setup();try{
 assert.equal((await t.post('/api/imports',{fixtureId:'unknown'})).status,404);
 assert.equal((await t.post('/api/imports',{blob:'x'.repeat(33000)})).status,413);
 assert.equal((await fetch(t.server.origin+'/api/imports',{method:'POST',headers:{'content-type':'application/json','x-session-token':t.token},body:'{broken'})).status,400);
 assert.equal((await fetch(t.server.origin+'/fixtures/heldout/gold/h01.json')).status,404);
 assert.equal((await fetch(t.server.origin+'/api/session')).status,200);
 }finally{await t.finish();}
});
test('real HTTP review applies one decision and retains original amounts',async()=>{
 const t=await setup();try{assert.equal((await t.post('/api/imports',{fixtureId:t.f.id})).status,200);const s=t.f.sources[0];const base=`/api/batches/${s.batchId}/receipts/${s.receiptId}`;
 assert.equal((await t.post(base+'/investigations',{})).status,202);
 let view=await(await fetch(t.server.origin+base+'/review')).json();const deadline=Date.now()+5000;while(view.status==='investigating'&&Date.now()<deadline){await new Promise(r=>setTimeout(r,20));view=await(await fetch(t.server.origin+base+'/review')).json();}assert.equal(view.status,'awaiting_review');assert.equal(view.posTotalMinor,'2212');assert.equal(view.accountingTotalMinor,'2211');
 const requestBody={proposalId:view.proposal.id,proposalVersion:view.proposal.version,snapshotDigest:view.proposal.snapshotDigest,idempotencyKey:'http-accept',decision:'accept'};
 const a=await(await t.post('/api/decisions',requestBody)).json();const b=await(await t.post('/api/decisions',requestBody)).json();assert.equal(a.intentId,b.intentId);
 await t.runner.wake();const final=await(await fetch(t.server.origin+base+'/review')).json();assert.equal(final.outcome,'reviewed_explained');assert.equal(final.posTotalMinor,'2212');assert.equal(final.accountingTotalMinor,'2211');
 }finally{await t.finish();}
});
