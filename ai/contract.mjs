import { MODES, CARDS } from '../public/core.mjs';
import { POLICY_VERSION, instructionsFor } from './policy.mjs';

export const SCHEMA_VERSION = 'liubai-candidate-0.1.0';
const LIMITS = Object.freeze({ reflection: 320, hypothesis: 200, question: 120, nextStep: 160 });
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype;
const text = (x, max) => typeof x === 'string' && x.trim().length > 0 && x.length <= max;
const keysAre = (x, keys) => plain(x) && Object.keys(x).length === keys.length && keys.every(k => Object.hasOwn(x, k));
const fail = reason => ({ ok: false, reason });
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

export const CANDIDATE_SCHEMA = freeze({
  type: 'object', additionalProperties: false, required: Object.keys(LIMITS),
  properties: Object.fromEntries(Object.entries(LIMITS).map(([key, maxLength]) => [key, {
    anyOf: [{ type: 'null' }, {
      type: 'object', additionalProperties: false, required: ['text', 'evidenceIds'],
      properties: {
        text: { type: 'string', minLength: 1, maxLength },
        evidenceIds: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string' } },
      },
    }],
  }])),
});

// Build a new snapshot from allowed session fields, never from saved AI prose.
export function buildContext({ session, revision, stage = 'reflect', questionsAsked = 0, allowNextStep = false, corrections = [] }) {
  const mode = MODES.find(m => m.id === session?.modeId);
  if (!mode || !text(session.id, 100) || !/^[a-zA-Z0-9_-]+$/.test(session.id)) throw new TypeError('invalid_session');
  if (!Number.isSafeInteger(revision) || revision < 0 || !['reflect', 'review'].includes(stage)) throw new TypeError('invalid_revision_or_stage');
  if (!Number.isInteger(questionsAsked) || questionsAsked < 0 || questionsAsked > 3 || typeof allowNextStep !== 'boolean') throw new TypeError('invalid_policy_state');
  if (!Array.isArray(corrections) || corrections.length > 8 || corrections.some(c => !text(c, 2000))) throw new TypeError('invalid_corrections');
  if (session.cardId !== null && session.cardId !== undefined && !CARDS.some(c => c.id === session.cardId)) throw new TypeError('invalid_card');
  const statements = [];
  const add = (id, value, kind = 'expression') => {
    if (value === undefined || value === '') return;
    if (typeof value !== 'string' || value.length > 20000) throw new TypeError('invalid_statement');
    if (value.trim()) statements.push({ id, text: value, kind });
  };
  for (const field of ['story', 'focus', 'cardReflection']) add(`u_${field}`, session[field]);
  for (const q of mode.questions) add(`u_${q.id}`, session.answers?.[q.id]);
  corrections.forEach((c, i) => add(`u_correction_${i + 1}`, c, 'correction'));
  const turns = session.turns ?? [];
  const feedback = session.feedback ?? [];
  if (!Array.isArray(turns) || turns.length > 3 || new Set(turns.map(t => t?.id)).size !== turns.length) throw new TypeError('invalid_turns');
  const dialogue = turns.map(t => {
    if (!keysAre(t, ['id', 'question', 'answer']) || !/^t[1-3]$/.test(t.id) || !text(t.question, 120) || typeof t.answer !== 'string' || t.answer.length > 3000) throw new TypeError('invalid_turns');
    add(`u_turn_${t.id}`, t.answer);
    return { question: t.question, answerId: t.answer.trim() ? `u_turn_${t.id}` : null, role: 'question_not_evidence' };
  });
  if (!Array.isArray(feedback) || feedback.length > 6) throw new TypeError('invalid_feedback');
  const candidateFeedback = feedback.map((f, i) => {
    if (!keysAre(f, ['hypothesisText', 'verdict', 'correction']) || !text(f.hypothesisText, 200) || !['accepted', 'rejected', 'uncertain'].includes(f.verdict) || typeof f.correction !== 'string' || f.correction.length > 1000) throw new TypeError('invalid_feedback');
    add(`u_feedback_${i + 1}`, f.correction, 'correction');
    return { hypothesisText: f.hypothesisText, verdict: f.verdict, correctionId: f.correction.trim() ? `u_feedback_${i + 1}` : null, role: 'model_candidate_not_evidence' };
  });
  if (!statements.length || statements.reduce((n, s) => n + s.text.length, 0) > 24000) throw new TypeError('empty_or_large_context');
  const card = CARDS.find(c => c.id === session.cardId);
  return freeze({ sessionId: session.id, revision, stage, modeId: mode.id, questionsAsked, allowNextStep, statements,
    card: card ? { name: card.name, prompt: card.prompt, role: 'optional_lens_not_evidence' } : null, dialogue, candidateFeedback });
}

function checkContext(context) {
  if (!keysAre(context, ['sessionId', 'revision', 'stage', 'modeId', 'questionsAsked', 'allowNextStep', 'statements', 'card', 'dialogue', 'candidateFeedback'])) throw new TypeError('invalid_context');
  if (!text(context.sessionId, 100) || !Number.isSafeInteger(context.revision) || context.revision < 0 || !['reflect', 'review'].includes(context.stage) || !MODES.some(m => m.id === context.modeId)) throw new TypeError('invalid_context');
  if (!Number.isInteger(context.questionsAsked) || context.questionsAsked < 0 || context.questionsAsked > 3 || typeof context.allowNextStep !== 'boolean') throw new TypeError('invalid_context');
  if (!Array.isArray(context.statements) || !context.statements.length || context.statements.length > 23) throw new TypeError('invalid_context');
  const ids = new Set();
  let length = 0;
  for (const s of context.statements) {
    if (!keysAre(s, ['id', 'text', 'kind']) || !/^u_[a-zA-Z0-9_-]+$/.test(s.id) || !text(s.id, 100) || !text(s.text, 20000) || !['expression', 'correction'].includes(s.kind) || ids.has(s.id)) throw new TypeError('invalid_context');
    ids.add(s.id); length += s.text.length;
  }
  if (length > 24000) throw new TypeError('invalid_context');
  if (context.card !== null && (!keysAre(context.card, ['name', 'prompt', 'role']) || !text(context.card.name, 100) || !text(context.card.prompt, 200) || context.card.role !== 'optional_lens_not_evidence')) throw new TypeError('invalid_context');
  if (!Array.isArray(context.dialogue) || context.dialogue.length > 3 || context.dialogue.some(t => !keysAre(t, ['question', 'answerId', 'role']) || !text(t.question, 120) || (t.answerId !== null && !ids.has(t.answerId)) || t.role !== 'question_not_evidence')) throw new TypeError('invalid_context');
  if (!Array.isArray(context.candidateFeedback) || context.candidateFeedback.length > 6 || context.candidateFeedback.some(f => !keysAre(f, ['hypothesisText', 'verdict', 'correctionId', 'role']) || !text(f.hypothesisText, 200) || !['accepted', 'rejected', 'uncertain'].includes(f.verdict) || (f.correctionId !== null && !ids.has(f.correctionId)) || f.role !== 'model_candidate_not_evidence')) throw new TypeError('invalid_context');
}

// Normalized adapter contract, NOT an HTTP body. Transport adapters map channels.
export function buildModelRequest(context, profile) {
  checkContext(context);
  if (!profile || !text(profile.providerId, 100) || !text(profile.modelId, 100) || !['instructions', 'developer', 'system'].includes(profile.instructionChannel) || typeof profile.structuredOutput !== 'boolean') throw new TypeError('unsupported_profile');
  return freeze({
    providerId: profile.providerId, modelId: profile.modelId,
    policyVersion: POLICY_VERSION, schemaVersion: SCHEMA_VERSION,
    instruction: { channel: profile.instructionChannel, text: instructionsFor(context) },
    input: { role: 'user', content: JSON.stringify({ kind: 'liubai_user_data', ...context }) },
    output: { format: profile.structuredOutput ? 'json_schema' : 'json_text', schema: CANDIDATE_SCHEMA },
  });
}

export function validateCandidate(value, context) {
  checkContext(context);
  if (!keysAre(value, Object.keys(LIMITS))) return fail('invalid_shape');
  const ids = new Set(context.statements.map(s => s.id));
  for (const [key, max] of Object.entries(LIMITS)) {
    const claim = value[key];
    if (claim === null) continue;
    if (!keysAre(claim, ['text', 'evidenceIds']) || !text(claim.text, max) || !Array.isArray(claim.evidenceIds) || claim.evidenceIds.length < 1 || claim.evidenceIds.length > 6) return fail('invalid_claim');
    if (new Set(claim.evidenceIds).size !== claim.evidenceIds.length || claim.evidenceIds.some(id => !ids.has(id))) return fail('invalid_evidence');
  }
  if (value.question && (context.stage !== 'reflect' || context.questionsAsked >= 3)) return fail('question_not_allowed');
  if (value.nextStep && (context.stage !== 'review' || !context.allowNextStep)) return fail('action_not_allowed');
  // Semantics (including multiple questions hidden in prose) need evaluation.
  return { ok: true, candidate: freeze(structuredClone(value)) };
}
