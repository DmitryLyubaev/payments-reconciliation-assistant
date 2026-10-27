import { z } from 'zod';
import type { ModelAdapter, ModelInput, ModelReply } from './contracts.js';
import { LiveBudget, LIVE_MODEL } from './live-budget.js';
import { CLAUDE_TOOLS } from './live-tools.js';

function conversation(input: ModelInput) {
  const messages: { role: 'user' | 'assistant'; content: unknown }[] = [];
  let system = '';
  for (const raw of input.messages) {
    const m = raw as Record<string, unknown>;
    if (m.role === 'system') system = String(m.content);
    else if (m.role === 'assistant') {
      const reply = m.reply as ModelReply;
      if (!reply.providerContent) throw new Error('INVALID_PROVIDER_HISTORY');
      messages.push({ role: 'assistant', content: reply.providerContent });
    } else if (m.role === 'tool') {
      const block = {
        type: 'tool_result',
        tool_use_id: m.callId,
        content: JSON.stringify(m.value),
      };
      const last = messages.at(-1);
      if (last?.role === 'user' && Array.isArray(last.content)) last.content.push(block);
      else messages.push({ role: 'user', content: [block] });
    } else if (m.role === 'user')
      messages.push({
        role: 'user',
        content: JSON.stringify({ batchId: m.batchId, receiptId: m.receiptId }),
      });
    else throw new Error('INVALID_PROVIDER_HISTORY');
  }
  return { system, messages };
}
const toolSchema = z.object({
  type: z.literal('tool_use'),
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  name: z.string(),
  input: z.record(z.string(), z.unknown()),
});
export function createAnthropicModel(options: {
  apiKey: string;
  budget: LiveBudget;
  transport?: typeof fetch;
}): ModelAdapter {
  if (!options.apiKey) throw new Error('ANTHROPIC_KEY_REQUIRED');
  const transport = options.transport ?? fetch;
  return {
    async next(input, signal) {
      const body = JSON.stringify({
        model: LIVE_MODEL,
        max_tokens: 4096,
        thinking: { type: 'between_tools' },
        output_config: { effort: 'low' },
        tool_choice: { type: 'auto' },
        tools: CLAUDE_TOOLS,
        ...conversation(input),
      });
      if (Buffer.byteLength(body) > 262144) throw new Error('PROVIDER_INPUT_LIMIT');
      if (signal.aborted) throw new Error('TIME_LIMIT');
      const reservation = options.budget.reserve({ threadId: input.threadId, turn: input.turn });
      let response: Response;
      try {
        response = await transport('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          redirect: 'error',
          signal,
          headers: {
            'content-type': 'application/json',
            'anthropic-version': '2023-06-01',
            'x-api-key': options.apiKey,
          },
          body,
        });
      } catch {
        throw new Error(signal.aborted ? 'TIME_LIMIT' : 'TRANSIENT');
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(
          response.status === 401
            ? 'PROVIDER_AUTH'
            : response.status === 403
              ? 'PROVIDER_ACCESS'
              : response.status === 429 || response.status >= 500
                ? 'TRANSIENT'
                : 'PROVIDER_REQUEST',
        );
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error('INVALID_USAGE');
      let size = 0;
      const chunks: Uint8Array[] = [];
      try {
        while (true) {
          const item = await reader.read();
          if (item.done) break;
          size += item.value.byteLength;
          if (size > 131072) {
            await reader.cancel();
            throw new Error('PROVIDER_RESPONSE_LIMIT');
          }
          chunks.push(item.value);
        }
      } catch {
        throw new Error('PROVIDER_RESPONSE_LIMIT');
      }
      let raw: Record<string, unknown>;
      try {
        raw = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        throw new Error('INVALID_USAGE');
      }
      options.budget.settle(
        reservation,
        raw.usage,
        String(response.headers.get('request-id') ?? raw.id ?? 'unavailable'),
      );
      if (raw.model !== LIVE_MODEL || raw.stop_reason !== 'tool_use' || !Array.isArray(raw.content))
        throw new Error('INVALID_PROVIDER_REPLY');
      const providerContent = raw.content;
      const calls = providerContent
        .filter((block: unknown) => (block as Record<string, unknown>)?.type === 'tool_use')
        .map((block) => {
          const parsed = toolSchema.safeParse(block);
          if (!parsed.success) throw new Error('INVALID_PROVIDER_REPLY');
          return parsed.data;
        });
      if (!calls.length) throw new Error('INVALID_PROVIDER_REPLY');
      if (calls.some((call) => call.name === 'submitProposal')) {
        if (calls.length !== 1) throw new Error('INVALID_PROVIDER_REPLY');
        return { type: 'proposal', proposal: calls[0].input, providerContent };
      }
      return {
        type: 'tools',
        calls: calls.map((call) => ({ id: call.id, name: call.name, args: call.input })),
        providerContent,
      };
    },
  };
}
