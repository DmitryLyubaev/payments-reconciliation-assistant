import { type Snapshot, type Analysis, type Category, type Calculation, sourceRef, policyRef, refKey } from './contracts.js';
import { calculateTax } from './money.js';

export function analyse(snapshot:Snapshot):Analysis {
  const {sources,policies}=snapshot;
  const pos=sources.filter(s=>s.source==='pos'), acct=sources.filter(s=>s.source==='accounting');
  const differenceMinor=pos.length===1&&acct.length===1 ? (BigInt(pos[0].grossMinor)-BigInt(acct[0].grossMinor)).toString():null;
  const requiredRefs=[...sources.map(sourceRef),...policies.map(policyRef)].sort((a,b)=>refKey(a).localeCompare(refKey(b)));
  const calculations:Calculation[]=[];const missing:string[]=[];
  let contradictory=pos.length>1||acct.length>1;
  if (!pos.length||!acct.length) missing.push('Missing counterpart source; difference unavailable');
  for(const source of sources) {
    if(BigInt(source.subtotalMinor)+BigInt(source.taxMinor)!==BigInt(source.grossMinor)) contradictory=true;
    if(source.lines&&source.lines.reduce((s,l)=>s+BigInt(l.netMinor),0n)!==BigInt(source.subtotalMinor)) contradictory=true;
    const applicable=policies.filter(p=>p.source===source.source);
    if(applicable.length>1) contradictory=true;
    if(!source.lines) missing.push(`Missing item detail: ${source.id}`);
    if(!applicable.length) missing.push(`Missing policy: ${source.source}`);
    if(source.lines) for(const rounding of ['per_item','per_receipt'] as const) {
      try { calculations.push({id:`${source.id}-v${source.version}-${rounding}`,sourceRef:sourceRef(source),rounding,...calculateTax(source.lines.map(l=>l.netMinor),rounding)}); }
      catch { contradictory=true; }
    }
  }
  let category:Category;
  if(contradictory) category='contradictory_evidence';
  else if(differenceMinor==='0') category='matched';
  else if(missing.length) category='insufficient_evidence';
  else {
    const explained=sources.every(source=>{
      const policy=policies.find(p=>p.source===source.source)!;
      const c=calculations.find(c=>c.sourceRef.id===source.id&&c.rounding===policy.rounding);
      return c?.grossMinor===source.grossMinor&&c.taxMinor===source.taxMinor;
    });
    category=explained?'explained_rounding':'unexplained_mismatch';
  }
  return {category,differenceMinor,eligible:category==='explained_rounding',requiredRefs,missing,calculations};
}
