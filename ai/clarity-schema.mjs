import { CLAIM_TYPES, checkClarityContext } from '../public/clarity-contract.mjs';
import { clarityTurn } from './clarity-turn.mjs';

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
  const plan = clarityTurn(context), end = plan.finish;
  const evidence = { type: 'array', minItems: 1, maxItems: context.statements.length,
    items: { type: 'string', enum: context.statements.map(s => s.id) } };
  const question = object({ text: string(160), target: { type: 'string', enum: ['event', 'interpretation', 'need', 'tradeoff', 'unknown', 'correction'] }, evidenceIds: evidence });
  const replacements = context.claims.map(c => c.id);
  // The previous mode is provisional. Do not prohibit a new scene or goal by
  // constraining this response to the previous model's classification.
  const types = context.allowNextStep ? ['action'] : CLAIM_TYPES.filter(t => t !== 'action');
  const claim = object({
    type: { type: 'string', enum: types },
    text: string(240), evidenceIds: evidence, derivation: { type: 'string', enum: ['stated', 'inferred'] },
    supersedes: { type: 'array', maxItems: replacements.length, items: replacements.length ? { type: 'string', enum: replacements } : { type: 'string' } },
  });
  const schema = object({ modeId: { type: 'string', enum: ['moment', 'concern', 'choice'] }, goal: string(80), reply: string(300),
    question: end ? { type: 'null' } : { anyOf: [question, { type: 'null' }] },
    claims: { type: 'array', minItems: end ? 1 : 0, maxItems: context.allowNextStep ? 1 : 3, items: claim },
    finish: end ? { type: 'boolean', const: true } : { type: 'boolean' }, title: string(60) });
  // Keep provider decoding to flat object/array constraints. Cross-field and
  // state relationships remain application checks. A real response added a
  // status field despite strict=true; conditional-schema behavior is unproven.
  return schema;
}
