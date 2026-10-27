import { analyse } from '../domain/reconcile.js';
import type { Snapshot, Analysis } from '../domain/contracts.js';
export function baseline(snapshot: Snapshot): Analysis {
  return analyse(snapshot);
}
