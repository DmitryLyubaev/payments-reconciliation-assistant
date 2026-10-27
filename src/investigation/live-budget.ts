import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';

export const MAX_CALL_NANO_USD = 2040960000n;
export const LIVE_MODEL = 'claude-sonnet-5-5';
export const LIVE_PRICES = {
  inputUsdPerMillion: '2',
  outputUsdPerMillion: '10',
  verifiedOn: '2026-10-27',
};
const usageSchema = z.object({
  input_tokens: z.number().int().min(0).max(1000000),
  output_tokens: z.number().int().min(0).max(4096),
  cache_creation_input_tokens: z.literal(0).optional(),
  cache_read_input_tokens: z.literal(0).optional(),
});
export class LiveBudget {
  private readonly db: Database.Database;
  constructor(
    path: string,
    readonly capNanoUsd = 5000000000n,
  ) {
    if (capNanoUsd <= 0n || capNanoUsd > 5000000000n) throw new Error('BUDGET_CAP');
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db
      .exec(`CREATE TABLE IF NOT EXISTS budget_meta (id INTEGER PRIMARY KEY, cap TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS calls (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, turn INTEGER NOT NULL,
      reserved TEXT NOT NULL, charged TEXT, usage TEXT, request_id TEXT, created_at TEXT NOT NULL);`);
    this.db
      .prepare('INSERT OR IGNORE INTO budget_meta(id,cap) VALUES(1,?)')
      .run(capNanoUsd.toString());
    if (
      (this.db.prepare('SELECT cap FROM budget_meta WHERE id=1').get() as { cap: string }).cap !==
      capNanoUsd.toString()
    ) {
      this.db.close();
      throw new Error('BUDGET_CAP');
    }
  }
  reserve(metadata: { threadId: string; turn: number }): string {
    return this.db
      .transaction(() => {
        if (BigInt(this.summary().committedNanoUsd) + MAX_CALL_NANO_USD > this.capNanoUsd)
          throw new Error('BUDGET_LIMIT');
        const id = randomUUID();
        this.db
          .prepare('INSERT INTO calls(id,thread_id,turn,reserved,created_at) VALUES(?,?,?,?,?)')
          .run(
            id,
            metadata.threadId,
            metadata.turn,
            MAX_CALL_NANO_USD.toString(),
            new Date().toISOString(),
          );
        return id;
      })
      .immediate();
  }
  settle(id: string, raw: unknown, requestId: string): void {
    const parsed = usageSchema.safeParse(raw);
    if (!parsed.success) throw new Error('INVALID_USAGE');
    const usage = parsed.data;
    const charge = BigInt(usage.input_tokens) * 2000n + BigInt(usage.output_tokens) * 10000n;
    this.db
      .transaction(() => {
        const row = this.db.prepare('SELECT charged,usage FROM calls WHERE id=?').get(id) as
          { charged: string | null; usage: string | null } | undefined;
        if (
          !row ||
          (row.charged !== null &&
            (row.charged !== charge.toString() || row.usage !== JSON.stringify(usage)))
        )
          throw new Error('USAGE_CONFLICT');
        this.db
          .prepare('UPDATE calls SET charged=?,usage=?,request_id=? WHERE id=?')
          .run(charge.toString(), JSON.stringify(usage), requestId, id);
      })
      .immediate();
  }
  summary() {
    const rows = this.db.prepare('SELECT * FROM calls ORDER BY rowid').all() as {
      id: string;
      thread_id: string;
      turn: number;
      reserved: string;
      charged: string | null;
      usage: string | null;
      request_id: string | null;
      created_at: string;
    }[];
    return {
      capNanoUsd: this.capNanoUsd.toString(),
      spentNanoUsd: rows.reduce((sum, row) => sum + BigInt(row.charged ?? '0'), 0n).toString(),
      committedNanoUsd: rows
        .reduce((sum, row) => sum + BigInt(row.charged ?? row.reserved), 0n)
        .toString(),
      unsettledCalls: rows.filter((row) => row.charged === null).length,
      calls: rows.map((row) => ({
        id: row.id,
        threadId: row.thread_id,
        turn: row.turn,
        chargedNanoUsd: row.charged,
        reservedNanoUsd: row.reserved,
        usage: row.usage ? JSON.parse(row.usage) : null,
        requestId: row.request_id,
        createdAt: row.created_at,
      })),
    };
  }
  close() {
    if (this.db.open) this.db.close();
  }
}
export type BudgetSummary = ReturnType<LiveBudget['summary']>;
export function usdFromNano(value: string): string {
  const n = BigInt(value);
  return `${n / 1000000000n}.${(n % 1000000000n).toString().padStart(9, '0')}`;
}
