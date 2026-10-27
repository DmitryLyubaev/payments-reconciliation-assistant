import type { Fixture, Snapshot } from '../../src/domain/contracts.js';
export function roundingFixture(id='test-rounding'):Fixture {
  const receiptId=`${id}-receipt`, batchId=`${id}-batch`;
  const common={version:1,batchId,receiptId,currency:'AUD' as const,basis:'exclusive' as const,rateBps:1000 as const,subtotalMinor:'2010',lines:[{id:'a',netMinor:'1005'},{id:'b',netMinor:'1005'}]};
  return {schemaVersion:1,id,sources:[{...common,id:`${id}-pos`,source:'pos',taxMinor:'202',grossMinor:'2212'},{...common,id:`${id}-acct`,source:'accounting',taxMinor:'201',grossMinor:'2211'}],policies:[{id:`${id}-p1`,version:1,batchId,receiptIds:[receiptId],source:'pos',rateBps:1000,rounding:'per_item',text:'Fictional POS policy: round tax per item.'},{id:`${id}-p2`,version:1,batchId,receiptIds:[receiptId],source:'accounting',rateBps:1000,rounding:'per_receipt',text:'Fictional export policy: round tax after summing.'}]};
}
export function fixtureSnapshot(fixture:Fixture):Snapshot {
  return {batchId:fixture.sources[0].batchId,receiptId:fixture.sources[0].receiptId,digest:'test-digest',sources:fixture.sources,policies:fixture.policies};
}
