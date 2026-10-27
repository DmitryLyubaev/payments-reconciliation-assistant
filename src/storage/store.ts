import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export function digestOf(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
export class Store {
  readonly db: Database.Database;
  constructor(readonly dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new Database(join(dataDir, 'app.sqlite'));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
    const columns = this.db.prepare('PRAGMA table_info(investigations)').all() as {
      name: string;
    }[];
    if (!columns.some((column) => column.name === 'model_json'))
      this.db.exec('ALTER TABLE investigations ADD COLUMN model_json TEXT');
  }
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
  audit(entity: string, type: string, body: unknown, eventKey: string | null = null): void {
    this.db
      .prepare(
        'INSERT OR IGNORE INTO audit_events(event_key,entity,type,body,created_at) VALUES(?,?,?,?,?)',
      )
      .run(eventKey, entity, type, JSON.stringify(body), new Date().toISOString());
  }
  history(entity: string): { seq: number; type: string; body: unknown; createdAt: string }[] {
    const rows = this.db
      .prepare('SELECT seq,type,body,created_at FROM audit_events WHERE entity=? ORDER BY seq')
      .all(entity) as { seq: number; type: string; body: string; created_at: string }[];
    return rows.map((r) => ({
      seq: r.seq,
      type: r.type,
      body: JSON.parse(r.body),
      createdAt: r.created_at,
    }));
  }
  close(): void {
    if (this.db.open) this.db.close();
  }
}
export function openStore(dataDir: string): Store {
  return new Store(dataDir);
}
