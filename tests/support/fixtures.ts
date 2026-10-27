import type { Fixture, Snapshot } from '../../src/domain/contracts.js';
import type { FakeScript } from '../../src/investigation/contracts.js';
export function roundingFixture(id='test-rounding'):Fixture {
  const receiptId=`${id}-receipt`, batchId=`${id}-batch`;
  const common={version:1,batchId,receiptId,currency:'AUD' as const,basis:'exclusive' as const,rateBps:1000 as const,subtotalMinor:'2010',lines:[{id:'a',netMinor:'1005'},{id:'b',netMinor:'1005'}]};
  return {schemaVersion:1,id,sources:[{...common,id:`${id}-pos`,source:'pos',taxMinor:'202',grossMinor:'2212'},{...common,id:`${id}-acct`,source:'accounting',taxMinor:'201',grossMinor:'2211'}],policies:[{id:`${id}-p1`,version:1,batchId,receiptIds:[receiptId],source:'pos',rateBps:1000,rounding:'per_item',text:'Fictional POS policy: round tax per item.'},{id:`${id}-p2`,version:1,batchId,receiptIds:[receiptId],source:'accounting',rateBps:1000,rounding:'per_receipt',text:'Fictional export policy: round tax after summing.'}]};
}
export function fixtureSnapshot(fixture:Fixture):Snapshot {
  return {batchId:fixture.sources[0].batchId,receiptId:fixture.sources[0].receiptId,digest:'test-digest',sources:fixture.sources,policies:fixture.policies};
}
export function roundingScript(f:Fixture):FakeScript {
  const refs=[...f.sources.map(s=>({kind:'source',id:s.id,version:s.version})),...f.policies.map(p=>({kind:'policy',id:p.id,version:p.version}))];
  const calcs=f.sources.map(s=>({source:s,rounding:s.source==='pos'?'per_item':'per_receipt'}));
  return {id:`${f.id}-script`,version:'1',steps:[{type:'tools',calls:[{id:'list',name:'listEvidence',args:{}}]},{type:'tools',calls:[...refs.map((r,i)=>({id:`read${i}`,name:'getEvidence',args:r})),...calcs.map((c,i)=>({id:`calc${i}`,name:'compareRounding',args:{sourceRef:{kind:'source',id:c.source.id,version:c.source.version},rounding:c.rounding}}))]},{type:'proposal',proposal:{category:'explained_rounding',differenceMinor:'1',evidenceRefs:refs,calculationIds:calcs.map(c=>`${c.source.id}-v${c.source.version}-${c.rounding}`),explanation:'The POS rounds tax per item while the accounting export rounds after summing. The fictional policies explain the one-cent difference.',nextStep:'Review the explanation. Retain the original totals.'}}]};
}
