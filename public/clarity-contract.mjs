// Shared, credential-free wire validation. Semantic truth still needs review.
export const CLARITY_FLOW = 'clarity-v2';
export const CLARITY_SCHEMA_VERSION = 'liubai-clarity-1';
export const CLAIM_TYPES = ['event', 'thought', 'feeling', 'need', 'option', 'tradeoff', 'unknown', 'insight', 'action'];
export const MODES = ['auto', 'moment', 'concern', 'choice'];
// Diagnostics are fixed codes, never model fields, text, or source identifiers.
// They are not part of the candidate wire schema or public JSON response.
export const CLAIM_VALIDATION_DETAILS = Object.freeze(['claim_shape', 'claim_type', 'claim_text', 'claim_evidence', 'claim_derivation',
  'supersedes_shape', 'supersedes_unknown', 'supersedes_duplicate']);
export const SHAPE_VALIDATION_DETAILS = Object.freeze(['shape_fields', 'shape_mode', 'shape_goal', 'shape_title', 'shape_reply', 'shape_finish', 'shape_claims']);
export const isClaimValidationDetail = value => typeof value === 'string' && CLAIM_VALIDATION_DETAILS.includes(value);
export const isClarityValidationDetail = (reason, value) => reason === 'invalid_claim' ? isClaimValidationDetail(value)
  : reason === 'invalid_shape' && typeof value === 'string' && SHAPE_VALIDATION_DETAILS.includes(value);
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const exact = (x, keys) => plain(x) && Object.keys(x).length === keys.length && keys.every(k => Object.hasOwn(x, k));
const text = (x, max) => typeof x === 'string' && x.trim().length > 0 && x.length <= max;
const id = x => text(x, 100) && /^[a-zA-Z0-9_-]+$/.test(x);
const list = (x, min, max) => Array.isArray(x) && x.length >= min && x.length <= max;
const unique = a => new Set(a).size === a.length;
const fail = reason => ({ ok: false, reason });
const failClaim = detail => ({ ok: false, reason: 'invalid_claim', detail });
const failShape = detail => ({ ok: false, reason: 'invalid_shape', detail });
export function declarativeReply(value) {
  // Only the dedicated question field may ask something. Preserve complete
  // declarative sentences; never splice words into a new claim or question.
  return (value.match(/[^。！？.!?]+[。！？.!?]?/gu) ?? []).filter(sentence => !/[？?]/u.test(sentence)).join('').trim();
}

export function checkClarityContext(c) {
  if (!exact(c, ['sessionId', 'revision', 'stage', 'allowNextStep', 'modeId', 'goal', 'statements', 'dialogue', 'claims']) ||
      !id(c.sessionId) || !Number.isSafeInteger(c.revision) || c.revision < 0 || !['reflect', 'review'].includes(c.stage) ||
      typeof c.allowNextStep !== 'boolean' || !MODES.includes(c.modeId) || !(c.goal === null || text(c.goal, 80)) ||
      !list(c.statements, 1, 12) || !list(c.dialogue, 0, 3) || !list(c.claims, 0, 15)) throw new TypeError('invalid_clarity_context');
  const ids = new Set();
  for (const s of c.statements) {
    if (!exact(s, ['id', 'text', 'kind']) || !id(s.id) || !/^u\d+$/.test(s.id) || ids.has(s.id) || !text(s.text, 4000) || !['expression', 'correction', 'request'].includes(s.kind)) throw new TypeError('invalid_statement');
    ids.add(s.id);
  }
  for (const d of c.dialogue) {
    if (!exact(d, ['question', 'answerId']) || !text(d.question, 160) || !ids.has(d.answerId)) throw new TypeError('invalid_dialogue');
  }
  const claimIds = new Set();
  for (const v of c.claims) {
    if (!exact(v, ['id', 'type', 'text', 'evidenceIds', 'derivation', 'status']) || !id(v.id) || claimIds.has(v.id) ||
        !CLAIM_TYPES.includes(v.type) || !text(v.text, 2000) || !list(v.evidenceIds, 1, 12) || !unique(v.evidenceIds) ||
        v.evidenceIds.some(k => !ids.has(k)) || !['stated', 'inferred'].includes(v.derivation) || !['candidate', 'edited', 'confirmed', 'stale'].includes(v.status)) throw new TypeError('invalid_claim_context');
    claimIds.add(v.id);
  }
  return c;
}

export function buildClarityContext({ session, revision, stage = 'reflect', allowNextStep = false }) {
  if (!session || !exact(session, ['id', 'modeId', 'goal', 'statements', 'dialogue', 'claims'])) throw new TypeError('invalid_clarity_session');
  return checkClarityContext(structuredClone({ sessionId: session.id, revision, stage, allowNextStep,
    modeId: session.modeId, goal: session.goal, statements: session.statements, dialogue: session.dialogue, claims: session.claims }));
}

export function validateClarityCandidate(value, context) {
  checkClarityContext(context);
  if (!exact(value, ['modeId', 'goal', 'reply', 'question', 'claims', 'finish', 'title'])) return failShape('shape_fields');
  if (!MODES.slice(1).includes(value.modeId)) return failShape('shape_mode');
  if (!text(value.goal, 80)) return failShape('shape_goal');
  if (!text(value.title, 60)) return failShape('shape_title');
  if (!text(value.reply, 300)) return failShape('shape_reply');
  if (typeof value.finish !== 'boolean') return failShape('shape_finish');
  if (!list(value.claims, 0, 3)) return failShape('shape_claims');
  const evidence = new Set(context.statements.map(s => s.id));
  const existing = new Set(context.claims.map(c => c.id));
  const sources = ids => list(ids, 1, 12) && unique(ids) && ids.every(x => evidence.has(x));
  const replaced = new Set();
  for (const claim of value.claims) {
    if (!exact(claim, ['type', 'text', 'evidenceIds', 'derivation', 'supersedes'])) return failClaim('claim_shape');
    if (!CLAIM_TYPES.includes(claim.type)) return failClaim('claim_type');
    if (!text(claim.text, 240)) return failClaim('claim_text');
    if (!sources(claim.evidenceIds)) return failClaim('claim_evidence');
    if (!['stated', 'inferred'].includes(claim.derivation)) return failClaim('claim_derivation');
    if (!list(claim.supersedes, 0, 15)) return failClaim('supersedes_shape');
    if (!unique(claim.supersedes)) return failClaim('supersedes_duplicate');
    if (claim.supersedes.some(k => !existing.has(k))) return failClaim('supersedes_unknown');
    if (claim.supersedes.some(k => replaced.has(k))) return failClaim('supersedes_duplicate');
    claim.supersedes.forEach(k => replaced.add(k));
    if (claim.type === 'action' && !context.allowNextStep) return fail('action_not_allowed');
  }
  if (value.claims.reduce((n, c) => n + c.text.length, 0) > 480) return fail('response_too_large');
  if (value.question !== null) {
    const q = value.question;
    if (!exact(q, ['text', 'target', 'evidenceIds']) || !text(q.text, 160) || !sources(q.evidenceIds) ||
        !['event', 'interpretation', 'need', 'tradeoff', 'unknown', 'correction'].includes(q.target)) return fail('invalid_question');
    if (value.finish || context.stage !== 'reflect' || context.dialogue.length >= 3) return fail('question_not_allowed');
    if (context.dialogue.some(d => d.question.trim() === q.text.trim())) return fail('repeated_question');
  } else if (!value.finish) return fail('missing_question');
  if (value.finish && !value.claims.length) return fail('empty_review');
  const candidate = structuredClone(value);
  candidate.reply = declarativeReply(candidate.reply);
  if (!candidate.reply) return fail('missing_declarative_reply');
  return { ok: true, candidate };
}
