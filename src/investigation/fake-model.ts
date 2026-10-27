import type { FakeScript, ModelAdapter, ModelReply } from './contracts.js';
export function createFakeModel(script: FakeScript): ModelAdapter {
  return {
    async next(input, signal) {
      if (signal.aborted) throw new Error('TIME_LIMIT');
      const step = structuredClone(script.steps[input.turn]) as Record<string, unknown> | undefined;
      if (!step) throw new Error('SCRIPT_EXHAUSTED');
      if (typeof step.error === 'string') throw new Error(step.error);
      return step as ModelReply;
    },
  };
}
export function requireOfflineMode(mode: string): void {
  if (mode !== 'fake') throw new Error('LIVE_MODE_NOT_CONFIGURED');
}
