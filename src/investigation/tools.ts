import { z } from 'zod';
import {
  refSchema,
  refKey,
  sourceRef,
  policyRef,
  type Snapshot,
  type Calculation,
  type Ref,
} from '../domain/contracts.js';
import { calculateTax } from '../domain/money.js';
import { type Store, digestOf } from '../storage/store.js';
import type { EvidenceTools } from './contracts.js';
export function createTools(store: Store, snapshot: Snapshot): EvidenceTools {
  const find = (raw: unknown) => {
    const ref = refSchema.parse(raw);
    const record = (ref.kind === 'source' ? snapshot.sources : snapshot.policies).find(
      (v) => v.id === ref.id && v.version === ref.version,
    );
    if (!record) throw new Error('OUT_OF_SCOPE');
    return { ref, record };
  };
  return {
    invoke(name, args, callId, threadId) {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(callId)) throw new Error('INVALID_CALL_ID');
      const argsDigest = digestOf(args);
      const row = store.db
        .prepare('SELECT * FROM tool_results WHERE thread_id=? AND call_id=?')
        .get(threadId, callId) as
        | { args_digest: string; snapshot_digest: string; payload: string | null; name: string }
        | undefined;
      if (
        row &&
        (row.args_digest !== argsDigest ||
          row.snapshot_digest !== snapshot.digest ||
          row.name !== name)
      )
        throw new Error('CALL_CONFLICT');
      if (row?.payload) {
        const saved = JSON.parse(row.payload);
        if (saved.error) throw new Error(saved.error);
        return saved.value;
      }
      if (!row) {
        const count = store.db
          .prepare('SELECT count(*) AS n FROM tool_results WHERE thread_id=?')
          .get(threadId) as { n: number };
        if (count.n >= 8) throw new Error('TOOL_LIMIT');
        store.db
          .prepare(
            'INSERT INTO tool_results(thread_id,call_id,name,args,args_digest,snapshot_digest) VALUES(?,?,?,?,?,?)',
          )
          .run(threadId, callId, name, JSON.stringify(args), argsDigest, snapshot.digest);
      }
      let payload: unknown;
      try {
        let value: unknown;
        if (name === 'listEvidence') {
          z.strictObject({}).parse(args);
          value = [...snapshot.sources.map(sourceRef), ...snapshot.policies.map(policyRef)];
        } else if (name === 'getEvidence') {
          value = find(args).record;
        } else if (name === 'compareRounding') {
          const parsed = z
            .strictObject({ sourceRef: refSchema, rounding: z.enum(['per_item', 'per_receipt']) })
            .parse(args);
          const { ref, record } = find(parsed.sourceRef);
          if (ref.kind !== 'source' || !('lines' in record) || !record.lines)
            throw new Error('MISSING_DETAIL');
          value = {
            id: `${record.id}-v${record.version}-${parsed.rounding}`,
            sourceRef: ref,
            rounding: parsed.rounding,
            ...calculateTax(
              record.lines.map((l) => l.netMinor),
              parsed.rounding,
            ),
          };
        } else throw new Error('UNKNOWN_TOOL');
        if (Buffer.byteLength(JSON.stringify(value)) > 16384)
          throw new Error('TOOL_RESPONSE_LIMIT');
        payload = { value };
      } catch (error) {
        const code =
          error instanceof z.ZodError
            ? 'INVALID_TOOL_ARGS'
            : error instanceof Error
              ? error.message
              : 'TOOL_FAILED';
        payload = { error: code };
      }
      store.db
        .prepare('UPDATE tool_results SET payload=? WHERE thread_id=? AND call_id=?')
        .run(JSON.stringify(payload), threadId, callId);
      store.audit(
        threadId,
        'tool_result',
        { callId, name, args, snapshotDigest: snapshot.digest, result: payload },
        `tool:${threadId}:${callId}`,
      );
      const result = payload as { value?: unknown; error?: string };
      if (result.error) throw new Error(result.error);
      return result.value;
    },
    calculations(threadId) {
      return (
        store.db
          .prepare(
            "SELECT payload FROM tool_results WHERE thread_id=? AND snapshot_digest=? AND name='compareRounding' AND payload IS NOT NULL",
          )
          .all(threadId, snapshot.digest) as { payload: string }[]
      )
        .map((r) => JSON.parse(r.payload).value)
        .filter(Boolean) as Calculation[];
    },
    readRefs(threadId) {
      return (
        store.db
          .prepare(
            "SELECT args,payload FROM tool_results WHERE thread_id=? AND snapshot_digest=? AND name='getEvidence' AND payload IS NOT NULL",
          )
          .all(threadId, snapshot.digest) as { args: string; payload: string }[]
      )
        .filter((r) => !JSON.parse(r.payload).error)
        .map((r) => JSON.parse(r.args) as Ref);
    },
  };
}
