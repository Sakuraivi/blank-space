import { expressionParts } from './clarity-turn.mjs';

export const CLARITY_GROUNDING_VERSION = 'clarity-grounding-4';
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
  let result = '', part = '', quoted = '';
  const ends = [];
  const pairs = { '“': '”', '「': '」', '『': '』', '"': '"' };
  for (const ch of text) {
    if (ends.length) {
      quoted += ch;
      if (ch === ends.at(-1)) ends.pop();
      else if (pairs[ch]) ends.push(pairs[ch]);
      if (!ends.length) { result += quoted; quoted = ''; }
    }
    else if (pairs[ch]) { result += transform(part); part = ''; quoted = ch; ends.push(pairs[ch]); }
    else part += ch;
  }
  return result + (ends.length ? quoted : transform(part));
}

function normalizeCorrection(text, fixes) {
  for (const fix of fixes) {
    const pair = new RegExp(`(^|[。！？!?\\n])(\\s*)(?:我)?不是${fix.from}[，,]\\s*是${fix.to}(?=[。！？!，,\\n]|$)`, 'gu');
    text = outsideQuotes(text, part => part.replace(pair, (_, boundary, space) => boundary + space + fix.to));
  }
  return text;
}

// Share the existing candidate matcher without widening its vocabulary or
// meaning. A rejection match is not by itself proof that a source can retire.
const ownEmotion = word => new RegExp(`(^|[。！？!?；;\\n])\\s*(?:我|你)?(?:其实|现在|还是|仍然|又|觉得|感到|很|挺|有些|有点|主要|是|不是|并非|并不|的感受是|的情绪是)*${word}`, 'u');
function referencesEmotion(text, words) {
  let found = false;
  outsideQuotes(text, part => { if (words.some(word => ownEmotion(word).test(part))) found = true; return part; });
  return found;
}

export function parseExplicitEmotionCorrection(text) {
  if (typeof text !== 'string') return null;
  const matched = text.match(correction);
  return matched ? Object.freeze({ from: matched[1], to: matched[2], positiveText: matched[2] + matched[3] }) : null;
}

export function inspectSourceEmotion(text, word) {
  if (typeof text !== 'string' || !emotions.split('|').includes(word)) throw new TypeError('invalid_emotion_reference');
  const referencesDenied = referencesEmotion(text, [word]);
  const matched = ownEmotion(word).exec(text);
  // Source perspective must be explicitly first-person and affirmative. The
  // old candidate matcher also accepts 你 and negative prefixes; those cannot
  // authorize deleting a user's source sentence. Mixed clauses stay intact.
  const prefix = matched ? matched[0].slice(0, -word.length) : '';
  const pureFirstPerson = referencesDenied && matched?.index === 0 && /^\s*我/u.test(prefix) &&
    !/(?:不是|并非|并不)/u.test(prefix) && /^[。.!！\s]*$/u.test(text.slice(matched[0].length));
  return Object.freeze({ referencesDenied, pureFirstPerson: Boolean(pureFirstPerson) });
}

export function groundClarityCandidate(candidate, context) {
  const plan = groundingPlan(context), value = structuredClone(candidate), denied = new Set();
  for (const fix of plan.corrections) { denied.delete(fix.to); denied.add(fix.from); }
  value.reply = normalizeCorrection(value.reply, plan.corrections);
  const repeatsDenied = text => referencesEmotion(text, [...denied]);
  for (const claim of value.claims) {
    // Never invent evidence or rewrite from an unreferenced correction.
    const fixes = plan.corrections.filter(f => claim.evidenceIds.includes(f.sourceId));
    claim.text = normalizeCorrection(claim.text, fixes);
    if (value.modeId === 'concern' && value.finish && claim.type === 'event' && !context.allowNextStep) {
      let lastIndex = -1, exact = claim.derivation === 'stated';
      for (const sentence of materialSentences(claim.text)) {
        const index = plan.sentences.findIndex((s, i) => i > lastIndex && s.text === sentence && claim.evidenceIds.includes(s.sourceId));
        if (index < 0) { exact = false; break; }
        lastIndex = index;
      }
      if (!exact) {
        const room = Math.min(240,480-value.claims.filter(c => c !== claim).reduce((n,c) => n+c.text.length,0));
        const selected = []; let length = 0;
        // Application-owned excerpts: complete original sentences only, with
        // their actual sources. The original statements remain intact.
        for (const sentence of plan.sentences) {
          const extra = sentence.text.length + (selected.length ? 1 : 0);
          if (length + extra > room) break;
          selected.push(sentence); length += extra;
        }
        if (!selected.length) return { ok:false,reason:'ungrounded_event' };
        claim.text = selected.map(s => s.text).join('\n');
        claim.evidenceIds = [...new Set(selected.map(s => s.sourceId))];
        claim.derivation = 'stated';
      }
    }
    // Exact source quotation and prefix reconstruction must obey the same
    // existing correction check as analysis; a once-valid old quote is not a
    // reason to restore a feeling the person explicitly corrected later.
    if (repeatsDenied(claim.text)) return { ok: false, reason: 'correction_not_applied' };
  }
  if ([value.reply, value.goal, value.title].some(repeatsDenied)) return { ok: false, reason: 'correction_not_applied' };
  return { ok: true, candidate: value };
}
