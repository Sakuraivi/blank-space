// Explicit v3-only compatibility. This module changes representation, never
// source IDs, permissions, prose, limits, claim types, or lifecycle decisions.
export const ADJUSTMENTS = Object.freeze([
  'json_whitespace', 'json_fence', 'question_default', 'claims_default', 'supersedes_default',
]);

export function safeFormatAdjustments(value) {
  try {
    if (!Array.isArray(value)) return [];
    const length = value.length;
    if (!Number.isInteger(length) || length < 0 || length > ADJUSTMENTS.length) return [];
    const safe = [];
    for (let i = 0; i < length; i++) {
      if (!Object.hasOwn(value, i)) return [];
      const item = value[i];
      if (typeof item !== 'string' || !ADJUSTMENTS.includes(item) || safe.includes(item)) return [];
      safe.push(item);
    }
    return safe;
  } catch { return []; }
}

const invalidJson = () => { throw new TypeError('invalid_json'); };

// JSON.parse silently chooses the last duplicate object member. Check the
// complete JSON grammar first so a wrapper cannot hide conflicting values.
// Keys are decoded as JSON strings: "finish" and "fin\\u0069sh" are identical.
function checkUnambiguousJson(source) {
  let offset = 0;
  const whitespace = () => { while (/[\x20\t\r\n]/u.test(source[offset] ?? '') && offset < source.length) offset++; };
  const string = () => {
    if (source[offset] !== '"') invalidJson();
    const start = offset++;
    while (offset < source.length) {
      const ch = source[offset++];
      if (ch === '"') {
        try { return JSON.parse(source.slice(start, offset)); }
        catch { invalidJson(); }
      }
      if (ch === '\\') offset++;
      else if (ch.charCodeAt(0) < 0x20) invalidJson();
    }
    invalidJson();
  };
  const value = depth => {
    whitespace();
    const ch = source[offset];
    if (ch === '{' || ch === '[') {
      if (depth >= 32) throw new RangeError('json_depth_exceeded');
      const object = ch === '{', close = object ? '}' : ']';
      offset++; whitespace();
      if (source[offset] === close) { offset++; return; }
      const keys = object ? new Set() : null;
      for (;;) {
        if (object) {
          const key = string();
          if (keys.has(key)) throw new TypeError('duplicate_json_key');
          keys.add(key); whitespace();
          if (source[offset++] !== ':') invalidJson();
        }
        value(depth + 1); whitespace();
        if (source[offset] === close) { offset++; return; }
        if (source[offset++] !== ',') invalidJson();
        whitespace();
      }
    }
    if (ch === '"') { string(); return; }
    for (const literal of ['true', 'false', 'null']) {
      if (source.startsWith(literal, offset)) { offset += literal.length; return; }
    }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(source.slice(offset));
    if (!number) invalidJson();
    offset += number[0].length;
  };
  value(0); whitespace();
  if (offset !== source.length) invalidJson();
}

export function decodeClarityV3Json(text) {
  if (typeof text !== 'string') invalidJson();
  let source = text.trim();
  const adjustments = [];
  if (source !== text) adjustments.push('json_whitespace');
  // Accept exactly one enclosing fenced block, not prose around an object,
  // multiple blocks, a JS expression, JSONC, or a partial JSON repair.
  const frame = /^```(?:json)?[\t ]*\r?\n([\s\S]*?)\r?\n```$/iu.exec(source);
  if (frame) {
    adjustments.push('json_fence');
    source = frame[1].trim();
    if (source !== frame[1] && !adjustments.includes('json_whitespace')) adjustments.push('json_whitespace');
  }
  checkUnambiguousJson(source);
  return { value: JSON.parse(source), adjustments };
}

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// These are explicit empty-value conventions, not inferred model intent.
// The complete canonical candidate MUST still pass the ordinary v3 validator.
export function normalizeClarityV3Candidate(value, context) {
  const candidate = structuredClone(value), adjustments = [];
  if (!plain(candidate)) return { candidate, adjustments };
  if (!Object.hasOwn(candidate, 'question')) {
    candidate.question = null; adjustments.push('question_default');
  }
  if (!Object.hasOwn(candidate, 'claims') && context?.stage === 'reflect' && context?.allowNextStep === false) {
    candidate.claims = []; adjustments.push('claims_default');
  }
  if (Array.isArray(candidate.claims) && Array.isArray(context?.claims) && context.claims.length === 0) {
    for (const claim of candidate.claims) {
      if (plain(claim) && !Object.hasOwn(claim, 'supersedes')) {
        claim.supersedes = [];
        if (!adjustments.includes('supersedes_default')) adjustments.push('supersedes_default');
      }
    }
  }
  return { candidate, adjustments };
}
