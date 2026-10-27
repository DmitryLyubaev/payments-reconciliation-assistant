import type { Analysis, Category, Calculation, Ref, Snapshot } from '../domain/contracts.js';
import type { Store } from '../storage/store.js';
export type Proposal={id:string;version:number;snapshotDigest:string;category:Exclude<Category,'matched'>;differenceMinor:string|null;evidenceRefs:Ref[];calculationIds:string[];explanation:string;nextStep:string;modelVersion:string;promptVersion:string};
export type InvestigationResult={status:'proposal';proposal:Proposal}|{status:'failed';code:string};
export type DecisionRequest={proposalId:string;proposalVersion:number;snapshotDigest:string;idempotencyKey:string;decision:'accept'|'reject'|'acknowledge'};
export type ToolCall={id:string;name:string;args:Record<string,unknown>};
export type ModelReply={type:'tools';calls:ToolCall[]}|{type:'proposal';proposal:unknown};
export type ModelInput={threadId:string;turn:number;messages:unknown[]};
export interface ModelAdapter{next(input:ModelInput,signal:AbortSignal):Promise<ModelReply>}
export type FakeScript={id:string;version:string;steps:unknown[]};
export interface EvidenceTools{invoke(name:string,args:unknown,callId:string,threadId:string):unknown;calculations(threadId:string):Calculation[];readRefs(threadId:string):Ref[]}
export type InvestigationState={threadId:string;snapshotDigest:string;turns:number;toolCalls:number;retriesRemaining:number;deadline:number;messages:unknown[];result?:InvestigationResult};
export type InvestigationDeps={store:Store;snapshot:Snapshot;analysis:Analysis;tools:EvidenceTools;model:ModelAdapter;now?:()=>number};
