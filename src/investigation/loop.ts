import { z } from 'zod';
import type { Snapshot } from '../domain/contracts.js';
import { refKey } from '../domain/contracts.js';
import type { InvestigationDeps, InvestigationState, ModelReply } from './contracts.js';
import { validateProposal } from './validate.js';
import { SYSTEM_PROMPT, PROMPT_VERSION } from './prompt.js';
const replySchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('tools'),
    calls: z
      .array(
        z.strictObject({
          id: z.string(),
          name: z.string(),
          args: z.record(z.string(), z.unknown()),
        }),
      )
      .max(100),
  }),
  z.strictObject({ type: z.literal('proposal'), proposal: z.record(z.string(), z.unknown()) }),
]);
export function initialInvestigationState(
  threadId: string,
  snapshot: Snapshot,
  now = Date.now(),
): InvestigationState {
  return {
    threadId,
    snapshotDigest: snapshot.digest,
    turns: 0,
    toolCalls: 0,
    retriesRemaining: 1,
    deadline: now + 60000,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', batchId: snapshot.batchId, receiptId: snapshot.receiptId },
    ],
  };
}
export async function stepInvestigation(
  deps: InvestigationDeps,
  previous: InvestigationState,
): Promise<InvestigationState> {
  const state = structuredClone(previous);
  if (state.result) return state;
  const now = deps.now ?? Date.now;
  const fail = (code: string) => {
    state.result = { status: 'failed', code };
    deps.store.audit(state.threadId, 'investigation_failed', { code }, `failed:${state.threadId}`);
    return state;
  };
  if (state.snapshotDigest !== deps.snapshot.digest) return fail('STALE');
  if (now() >= state.deadline) return fail('TIME_LIMIT');
  if (state.turns >= 6) return fail('MODEL_LIMIT');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  const turn = state.turns;
  try {
    const saved = deps.store.db
      .prepare('SELECT status,payload FROM model_attempts WHERE thread_id=? AND turn=?')
      .get(state.threadId, turn) as { status: string; payload: string | null } | undefined;
    state.turns++;
    let raw: unknown;
    if (saved) {
      if (saved.status !== 'completed' || !saved.payload) return fail('INTERRUPTED_ATTEMPT');
      raw = JSON.parse(saved.payload);
    } else {
      deps.store.db
        .prepare("INSERT INTO model_attempts(thread_id,turn,status) VALUES(?,?,'started')")
        .run(state.threadId, turn);
      raw = await Promise.race([
        deps.model.next(
          { threadId: state.threadId, turn, messages: state.messages },
          controller.signal,
        ),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => {
              controller.abort();
              reject(new Error('TIME_LIMIT'));
            },
            Math.max(1, state.deadline - now()),
          );
        }),
      ]);
      if (Buffer.byteLength(JSON.stringify(raw)) > 32768) throw new Error('MODEL_RESPONSE_LIMIT');
      deps.store.db
        .prepare(
          "UPDATE model_attempts SET status='completed',payload=? WHERE thread_id=? AND turn=?",
        )
        .run(JSON.stringify(raw), state.threadId, turn);
    }
    const reply = replySchema.parse(raw) as ModelReply;
    state.messages.push({ role: 'assistant', reply });
    if (reply.type === 'tools') {
      if (state.toolCalls + reply.calls.length > 8) return fail('TOOL_LIMIT');
      for (const call of reply.calls) {
        state.toolCalls++;
        const value = deps.tools.invoke(call.name, call.args, call.id, state.threadId);
        state.messages.push({ role: 'tool', callId: call.id, value });
      }
    } else {
      const refs = new Set(deps.tools.readRefs(state.threadId).map(refKey));
      if (deps.analysis.requiredRefs.some((ref) => !refs.has(refKey(ref))))
        return fail('UNREAD_EVIDENCE');
      const p = validateProposal(
        {
          ...(reply.proposal as object),
          id: `proposal_${state.threadId}`,
          version: 1,
          snapshotDigest: state.snapshotDigest,
          modelVersion: 'fake-scripted-v1',
          promptVersion: PROMPT_VERSION,
        },
        deps.snapshot,
        deps.analysis,
        deps.tools.calculations(state.threadId),
      );
      state.result = { status: 'proposal', proposal: p };
    }
    return state;
  } catch (error) {
    const code =
      error instanceof z.ZodError
        ? 'INVALID_MODEL_OUTPUT'
        : error instanceof Error
          ? error.message
          : 'INVESTIGATION_FAILED';
    deps.store.db
      .prepare(
        "UPDATE model_attempts SET status='error',payload=? WHERE thread_id=? AND turn=? AND status='started'",
      )
      .run(JSON.stringify({ code }), state.threadId, turn);
    if (code === 'TRANSIENT' && state.retriesRemaining > 0) {
      state.retriesRemaining--;
      deps.store.audit(state.threadId, 'model_retry', { code, turn: state.turns });
      return state;
    }
    return fail(code);
  } finally {
    if (timer) clearTimeout(timer);
    controller.abort();
  }
}
