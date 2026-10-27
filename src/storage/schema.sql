CREATE TABLE IF NOT EXISTS source_versions (id TEXT NOT NULL, version INTEGER NOT NULL, payload TEXT NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(id,version));
CREATE TABLE IF NOT EXISTS policy_versions (id TEXT NOT NULL, version INTEGER NOT NULL, payload TEXT NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(id,version));
CREATE TABLE IF NOT EXISTS receipt_heads (batch_id TEXT NOT NULL, receipt_id TEXT NOT NULL, digest TEXT NOT NULL, revision INTEGER NOT NULL, snapshot TEXT NOT NULL, PRIMARY KEY(batch_id,receipt_id));
CREATE TABLE IF NOT EXISTS imports (fixture_id TEXT NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(fixture_id,digest));
CREATE TABLE IF NOT EXISTS audit_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, event_key TEXT UNIQUE, entity TEXT NOT NULL, type TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tool_results (thread_id TEXT NOT NULL, call_id TEXT NOT NULL, name TEXT NOT NULL, args TEXT NOT NULL, args_digest TEXT NOT NULL, snapshot_digest TEXT NOT NULL, payload TEXT, PRIMARY KEY(thread_id,call_id));
CREATE TABLE IF NOT EXISTS model_attempts (thread_id TEXT NOT NULL, turn INTEGER NOT NULL, status TEXT NOT NULL, payload TEXT, PRIMARY KEY(thread_id,turn));
