import { expressionParts } from './clarity-turn.mjs';

export const CLARITY_GROUNDING_VERSION = 'clarity-grounding-2';
const emotions = '失落|生气|愤怒|难过|委屈|焦虑|害怕|担心|开心|轻松|烦躁|烦|紧张|内疚|羞愧|疲惫';
const correction = new RegExp(`^(?:我)?不是(${emotions})[，,]\\s*是(${emotions})([。.!！]?)$`, 'u');

// Full sentence boundaries only: do not detach a qualifier from its clause,
// split quoted speech, or mistake decimal punctuation for a sentence end.
export function materialSentences(text) {
  const result = [], quotes = [], pairs = { '“': '”', '「': '」', '『': '』', '"': '"' };
  let part = '';
  const push = () => { if (part.trim()) result.push(part.trim()); part = ''; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]; part += ch;
    if (quotes.at(-1) === ch) quotes.pop();
    else if (pairs[ch]) quotes.push(pairs[ch]);
    else if (!quotes.length && (/[。！？!?\n]/u.test(ch) || ch === '.' && (i === text.length - 1 || /\s/u.test(text[i + 1])))) push();
  }
  push(); return result;
}

export function groundingPlan(context) {
  const sentences = [], corrections = [];
  for (const source of context.statements.filter(s => s.kind !== 'request')) {
    for (const original of materialSentences(source.text)) {
      if (!expressionParts(original).content) continue;
      const matched = original.match(correction);
      if (matched) {
        corrections.push({ sourceId: source.id, from: matched[1], to: matched[2] });
        // This positive suffix is still an exact substring of the source.
        sentences.push({ sourceId: source.id, text: matched[2] + matched[3] });
      } else sentences.push({ sourceId: source.id, text: original });
    }
  }
  return { version: CLARITY_GROUNDING_VERSION, sentences, corrections };
}

function outsideQuotes(text, transform) {
  let result = '', part = '', quoted = '', end = null;
  const pairs = { '“': '”', '「': '」', '『': '』', '"': '"' };
  for (const ch of text) {
    if (end) { quoted += ch; if (ch === end) { result += quoted; quoted = ''; end = null; } }
    else if (pairs[ch]) { result += transform(part); part = ''; quoted = ch; end = pairs[ch]; }
    else part += ch;
  }
  return result + (end ? quoted : transform(part));
}

function normalizeCorrection(text, fixes) {
  for (const fix of fixes) {
    const pair = new RegExp(`(^|[。！？!?\\n])(\\s*)(?:我)?不是${fix.from}[，,]\\s*是${fix.to}(?=[。！？!，,\\n]|$)`, 'gu');
    text = outsideQuotes(text, part => part.replace(pair, (_, boundary, space) => boundary + space + fix.to));
  }
  return text;
}

export function groundClarityCandidate(candidate, context) {
  const plan = groundingPlan(context), value = structuredClone(candidate), denied = new Set();
  for (const fix of plan.corrections) { denied.delete(fix.to); denied.add(fix.from); }
  value.reply = normalizeCorrection(value.reply, plan.corrections);
  const ownEmotion = word => new RegExp(`(^|[。！？!?；;\\n])\\s*(?:我|你)?(?:其实|现在|还是|仍然|又|觉得|感到|很|挺|有些|有点|主要|是|不是|并非|并不|的感受是|的情绪是)*${word}`, 'u');
  const repeatsDenied = text => {
    let found = false;
    outsideQuotes(text, part => { if ([...denied].some(word => ownEmotion(word).test(part))) found = true; return part; });
    return found;
  };
  for (const claim of value.claims) {
    // Never invent evidence or rewrite from an unreferenced correction.
    const fixes = plan.corrections.filter(f => claim.evidenceIds.includes(f.sourceId));
    claim.text = normalizeCorrection(claim.text, fixes);
    if (value.modeId === 'concern' && value.finish && claim.type === 'event' && !context.allowNextStep) {
      let lastIndex = -1;
      for (const sentence of materialSentences(claim.text)) {
        const index = plan.sentences.findIndex((s, i) => i > lastIndex && s.text === sentence && claim.evidenceIds.includes(s.sourceId));
        if (index < 0) return { ok: false, reason: 'ungrounded_event' };
        lastIndex = index;
      }
      if (claim.derivation !== 'stated') return { ok: false, reason: 'ungrounded_event' };
    } else if (repeatsDenied(claim.text)) return { ok: false, reason: 'correction_not_applied' };
  }
  if ([value.reply, value.goal, value.title].some(repeatsDenied)) return { ok: false, reason: 'correction_not_applied' };
  return { ok: true, candidate: value };
}
