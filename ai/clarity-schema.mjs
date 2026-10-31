import { CLAIM_TYPES, checkClarityContext } from '../public/clarity-contract.mjs';

// Exact aliases with documented strict JSON Schema support. Do not infer a
// capability from a provider name or from a user-entered model ID prefix.
// https://help.aliyun.com/zh/model-studio/qwen-structured-output (2026-10-31)
export function supportsClaritySchema(providerId, modelId) {
  return providerId === 'bailian' && ['qwen3.8-max', 'qwen3.8-flash'].includes(modelId);
}
const string = maxLength => ({ type: 'string', minLength: 1, maxLength });
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });

// Format constraints are not evidence of semantic truth. The application still
// checks sources, duplicates, aggregate length, state, and protected edits.
export function clarityOutputSchema(context) {
  checkClarityContext(context);
  const end = context.stage === 'review' || context.dialogue.length >= 3 || context.allowNextStep;
  const evidence = { type: 'array', minItems: 1, maxItems: context.statements.length,
    items: { type: 'string', enum: context.statements.map(s => s.id) } };
  const question = object({ text: string(160), target: { type: 'string', enum: ['event', 'interpretation', 'need', 'tradeoff', 'unknown', 'correction'] }, evidenceIds: evidence });
  const replacements = context.claims.map(c => c.id);
  const claim = object({
    type: { type: 'string', enum: context.allowNextStep ? ['action'] : CLAIM_TYPES.filter(t => t !== 'action') },
    text: string(240), evidenceIds: evidence, derivation: { type: 'string', enum: ['stated', 'inferred'] },
    supersedes: { type: 'array', maxItems: replacements.length, items: replacements.length ? { type: 'string', enum: replacements } : { type: 'string' } },
  });
  const schema = object({ modeId: { type: 'string', enum: ['moment', 'concern', 'choice'] }, goal: string(80), reply: string(300),
    question: end ? { type: 'null' } : { anyOf: [question, { type: 'null' }] },
    claims: { type: 'array', minItems: end ? 1 : 0, maxItems: context.allowNextStep ? 1 : 3, items: claim },
    finish: end ? { type: 'boolean', const: true } : { type: 'boolean' }, title: string(60) });
  // Early finish is valid. A question and finish=true must never coexist.
  if (!end) schema.allOf = [{ if: { properties: { finish: { const: true } } },
    then: { properties: { question: { type: 'null' }, claims: { minItems: 1 } } },
    else: { properties: { question } } }];
  // A finished concern uses narrative sections, not another list of labels.
  // Unknown remains optional: the schema must not invent an information gap.
  if (!context.allowNextStep) (schema.allOf ??= []).push({
    if: { properties: { finish: { const: true }, modeId: { const: 'concern' } } },
    then: { properties: { claims: { items: { properties: { type: { enum: ['event', 'insight', 'unknown'] } } } } } },
  });
  return schema;
}
