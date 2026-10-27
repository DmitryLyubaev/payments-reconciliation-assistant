import { parseFixture, type Source, type Policy, type Snapshot } from '../domain/contracts.js';
import { type Store, canonical, digestOf } from './store.js';
export type ImportResult={status:'imported'|'replayed';fixtureId:string;snapshotDigests:string[]}|{status:'rejected';code:string};
export function entityKey(batchId:string,receiptId:string):string{return `${batchId}/${receiptId}`;}
function latest<T>(store:Store,table:'source_versions'|'policy_versions'):T[]{
  return (store.db.prepare(`SELECT payload FROM ${table} v WHERE version=(SELECT MAX(version) FROM ${table} WHERE id=v.id)`).all() as {payload:string}[]).map(r=>JSON.parse(r.payload));
}
export function loadSnapshot(store:Store,batchId:string,receiptId:string):Snapshot {
  const row=store.db.prepare('SELECT snapshot FROM receipt_heads WHERE batch_id=? AND receipt_id=?').get(batchId,receiptId) as {snapshot:string}|undefined;
  if(!row)throw new Error('NOT_FOUND');return JSON.parse(row.snapshot);
}
export function importFixture(store:Store,raw:unknown):ImportResult {
  let fixture;try{fixture=parseFixture(raw);}catch{store.audit('imports','import_rejected',{code:'INVALID_FIXTURE'});return {status:'rejected',code:'INVALID_FIXTURE'};}
  try{return store.transaction(()=>{
    const digest=digestOf(fixture);
    const replay=!!store.db.prepare('SELECT 1 FROM imports WHERE fixture_id=? AND digest=?').get(fixture.id,digest);
    for(const [table,records] of [['source_versions',fixture.sources],['policy_versions',fixture.policies]] as const)for(const record of records){
      const existing=store.db.prepare(`SELECT digest FROM ${table} WHERE id=? AND version=?`).get(record.id,record.version) as {digest:string}|undefined;
      if(existing&&existing.digest!==digestOf(record))throw new Error('VERSION_CONFLICT');
      const previous=store.db.prepare(`SELECT payload FROM ${table} WHERE id=? ORDER BY version DESC LIMIT 1`).get(record.id) as {payload:string}|undefined;
      if(previous){const old=JSON.parse(previous.payload);if(old.batchId!==record.batchId||old.source!==record.source||('receiptId' in record&&old.receiptId!==record.receiptId))throw new Error('IDENTITY_CONFLICT');}
      store.db.prepare(`INSERT OR IGNORE INTO ${table}(id,version,payload,digest) VALUES(?,?,?,?)`).run(record.id,record.version,canonical(record),digestOf(record));
    }
    const sources=latest<Source>(store,'source_versions'),policies=latest<Policy>(store,'policy_versions');
    const pairs=new Map(sources.map(s=>[entityKey(s.batchId,s.receiptId),s]));const snapshotDigests:string[]=[];
    for(const source of pairs.values()){
      const data={batchId:source.batchId,receiptId:source.receiptId,sources:sources.filter(s=>s.batchId===source.batchId&&s.receiptId===source.receiptId),policies:policies.filter(p=>p.batchId===source.batchId&&p.receiptIds.includes(source.receiptId))};
      const snapshot={...data,digest:digestOf(data)};
      store.db.prepare('INSERT INTO receipt_heads(batch_id,receipt_id,digest,revision,snapshot) VALUES(?,?,?,1,?) ON CONFLICT(batch_id,receipt_id) DO UPDATE SET digest=excluded.digest,revision=revision+1,snapshot=excluded.snapshot WHERE receipt_heads.digest<>excluded.digest').run(source.batchId,source.receiptId,snapshot.digest,canonical(snapshot));
      snapshotDigests.push(snapshot.digest);
    }
    store.db.prepare('INSERT OR IGNORE INTO imports(fixture_id,digest) VALUES(?,?)').run(fixture.id,digest);
    store.audit('imports',replay?'import_replayed':'imported',{fixtureId:fixture.id,digest});
    return {status:replay?'replayed':'imported',fixtureId:fixture.id,snapshotDigests:snapshotDigests.sort()};
  });}catch(error){const code=error instanceof Error?error.message:'IMPORT_FAILED';if(!['VERSION_CONFLICT','IDENTITY_CONFLICT'].includes(code))throw error;store.audit('imports','import_rejected',{fixtureId:fixture.id,code});return {status:'rejected',code};}
}
