import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFixture } from '../../src/domain/contracts.js';

const source = { id:'s1',version:1,batchId:'b1',receiptId:'r1',source:'pos',currency:'AUD',basis:'exclusive',rateBps:1000,subtotalMinor:'2010',taxMinor:'202',grossMinor:'2212',lines:[{id:'a',netMinor:'1005'},{id:'b',netMinor:'1005'}] };
test('schemas reject unsupported accounting conventions and duplicate lines', () => {
  for (const change of [{currency:'USD'}, {basis:'inclusive'}, {rateBps:500}, {lines:[{id:'a',netMinor:'0'}]}, {lines:[{id:'a',netMinor:'1005'},{id:'a',netMinor:'1005'}]}]) {
    assert.throws(() => parseFixture({schemaVersion:1,id:'f1',sources:[{...source,...change}],policies:[]}));
  }
  assert.equal(parseFixture({schemaVersion:1,id:'f1',sources:[{...source,lines:null}],policies:[]}).sources[0].lines, null);
});
