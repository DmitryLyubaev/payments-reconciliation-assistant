import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openStore } from '../../src/storage/store.js';
export function tempStore() {
  const dir=mkdtempSync(join(tmpdir(),'payment app '));
  const store=openStore(dir);
  return {store,dir,close(){store.close();rmSync(dir,{recursive:true,force:true});}};
}
