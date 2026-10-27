const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const string = { type: 'string' };
const ref = object({
  kind: { type: 'string', enum: ['source', 'policy'] },
  id: string,
  version: { type: 'integer', minimum: 1 },
});
export const CLAUDE_TOOLS = [
  {
    name: 'listEvidence',
    description: 'List every source and applicable policy reference for this receipt. Start here.',
    input_schema: object({}),
  },
  {
    name: 'getEvidence',
    description:
      'Read one listed source or policy reference. Read every listed reference before proposing.',
    input_schema: ref,
  },
  {
    name: 'compareRounding',
    description:
      'Calculate exact tax and gross for one source under its applicable policy rounding. Read policy first. Use at most one applicable profile per source.',
    input_schema: object({
      sourceRef: ref,
      rounding: { type: 'string', enum: ['per_item', 'per_receipt'] },
    }),
  },
  {
    name: 'submitProposal',
    description:
      'Finish by submitting a supported explanation or an explicit unresolved exception. No approval or source changes occur. Do not mix with evidence tool calls.',
    input_schema: object({
      category: {
        type: 'string',
        enum: [
          'explained_rounding',
          'insufficient_evidence',
          'contradictory_evidence',
          'unexplained_mismatch',
        ],
      },
      differenceMinor: { anyOf: [string, { type: 'null' }] },
      evidenceRefs: { type: 'array', items: ref },
      calculationIds: { type: 'array', items: string },
      explanation: string,
      nextStep: string,
    }),
  },
].map((tool) => ({ ...tool, strict: true }));
