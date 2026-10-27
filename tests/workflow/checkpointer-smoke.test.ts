import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import { Annotation, StateGraph, START, END, interrupt, Command } from '@langchain/langgraph';

test('native SQLite checkpoints survive closing and reopening a file with spaces', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'payment checkpoint '));
  const state = Annotation.Root({approved:Annotation<boolean>});
  const build = (db: Database.Database) => new StateGraph(state).addNode('review', () => ({approved:interrupt('Review?')})).addEdge(START,'review').addEdge('review',END).compile({checkpointer:new SqliteSaver(db)});
  let db = new Database(join(dir,'checkpoints.sqlite'));
  try {
    const config = {configurable:{thread_id:'smoke'}};
    const first = await build(db).invoke({approved:false}, config);
    assert.ok(first.__interrupt__?.length);
    db.close(); db = new Database(join(dir,'checkpoints.sqlite'));
    const final = await build(db).invoke(new Command({resume:true}), config);
    assert.equal(final.approved,true);
  } finally { if (db.open) db.close(); rmSync(dir,{recursive:true,force:true}); }
});
