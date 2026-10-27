import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LiveBudget } from '../../src/investigation/live-budget.js';
import { createAnthropicModel } from '../../src/investigation/anthropic-model.js';

test('Claude adapter reserves before transport and preserves signed blocks and tool results', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'payment claude '));
  const budget = new LiveBudget(join(dir, 'budget.sqlite'));
  const content = [
    { type: 'thinking', thinking: 'private provider block', signature: 'signed' },
    { type: 'tool_use', id: 'toolu_1', name: 'listEvidence', input: {} },
  ];
  const requests: Record<string, unknown>[] = [];
  const transport: typeof fetch = async (_url, init) => {
    assert.equal(budget.summary().unsettledCalls, 1);
    requests.push(JSON.parse(String(init?.body)));
    return Response.json({
      id: 'msg-1',
      model: 'claude-sonnet-5-5',
      stop_reason: 'tool_use',
      content,
      usage: { input_tokens: 1000, output_tokens: 100 },
    });
  };
  const model = createAnthropicModel({ apiKey: 'test-key', budget, transport });
  try {
    const input = {
      threadId: 'thread',
      turn: 0,
      messages: [
        { role: 'system', content: 'fixed' },
        { role: 'user', batchId: 'batch', receiptId: 'receipt' },
      ],
    };
    const first = await model.next(input, new AbortController().signal);
    assert.equal(first.type, 'tools');
    await model.next(
      {
        ...input,
        turn: 1,
        messages: [
          ...input.messages,
          { role: 'assistant', reply: first },
          { role: 'tool', callId: 'toolu_1', value: [{ kind: 'source', id: 's1', version: 1 }] },
        ],
      },
      new AbortController().signal,
    );
    assert.deepEqual((requests[1].messages as unknown[])[1], { role: 'assistant', content });
    assert.deepEqual((requests[1].messages as unknown[])[2], {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_1',
          content: '[{"kind":"source","id":"s1","version":1}]',
        },
      ],
    });
    assert.equal(requests[0].model, 'claude-sonnet-5-5');
    assert.equal(requests[0].max_tokens, 4096);
    assert.deepEqual(requests[0].thinking, { type: 'between_tools' });
    assert.deepEqual(requests[0].tool_choice, { type: 'auto' });
    assert.equal(budget.summary().spentNanoUsd, '6000000');
  } finally {
    budget.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Claude malformed replies retain measured usage and missing usage retains its reservation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'payment claude bad '));
  const budget = new LiveBudget(join(dir, 'budget.sqlite'));
  try {
    const model = createAnthropicModel({
      apiKey: 'do-not-expose',
      budget,
      transport: async () =>
        Response.json({
          model: 'claude-sonnet-5-5',
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'not a proposal' }],
          usage: { input_tokens: 1000, output_tokens: 100 },
        }),
    });
    const input = {
      threadId: 'thread',
      turn: 0,
      messages: [
        { role: 'system', content: 'fixed' },
        { role: 'user', batchId: 'b', receiptId: 'r' },
      ],
    };
    await assert.rejects(model.next(input, new AbortController().signal), /INVALID_PROVIDER_REPLY/);
    assert.equal(budget.summary().spentNanoUsd, '3000000');
    const missing = createAnthropicModel({
      apiKey: 'do-not-expose',
      budget,
      transport: async () => Response.json({ error: { message: 'do-not-expose' } }),
    });
    await assert.rejects(missing.next(input, new AbortController().signal), /INVALID_USAGE/);
    assert.equal(budget.summary().unsettledCalls, 1);
  } finally {
    budget.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
