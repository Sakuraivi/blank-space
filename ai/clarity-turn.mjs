// Application-owned conversational controls. Cues decide what to ask next;
// they never establish facts, feelings, or third-party intentions as true.
export const CLARITY_TURN_VERSION = 'clarity-turn-6';
export const CONCERN_QUESTIONS = Object.freeze({
  event: '能说说最近一次发生时，具体是什么情形吗？',
  interpretation: '这件事里，最让你介意的是什么？',
  need: '你希望接下来有什么具体的不同？',
});

// Recognize only standalone interaction requests, not quoted speech, mixed
// clauses, or words inside a story. Original statements remain untouched.
export function expressionParts(text) {
  const chunks = []; let chunk = '', quote = null;
  const pairs = { '“': '”', '「': '」', '『': '』', '"': '"' };
  for (const ch of text) {
    chunk += ch;
    if (quote) { if (ch === quote) quote = null; }
    else if (pairs[ch]) quote = pairs[ch];
    else if (/[。！？!?；;，,\n]/u.test(ch)) { chunks.push(chunk); chunk = ''; }
  }
  if (chunk) chunks.push(chunk);
  const controls = [], content = [];
  for (const part of chunks) {
    const core = part.trim().replace(/[。！？!?；;，,]$/u, '').trim();
    const record = /^(?:我)?(?:只想|只要|就想|就要|就)(?:把)?(?:留住|留下|保留|记录|记下)(?:这一句|这句话|这句|原话|这一句话)(?:就好|就行|即可)?$/u.test(core);
    const stop = /^(?:(?:我)?(?:不想|不愿意)(?:再|继续)?(?:说|聊|回答)(?:了)?|(?:不用|不要|不必)(?:再|继续)?(?:追问|问我|问了)(?:了)?|(?:先)?(?:到这里|这样)(?:吧|就好|就行)?|(?:我)?(?:不需要|不用|不要)(?:再)?(?:分析|建议|分析或建议|分析和建议))$/u.test(core);
    if (record || stop) controls.push({ text: part, record, stop });
    else content.push(part);
  }
  return { content: content.join('').trim().replace(/[，,；;]$/u, '。'), controls };
}

export function clarityTurn(context) {
  const materials = context.statements.map(s => ({ id: s.id, ...expressionParts(s.text) }));
  const last = materials.at(-1), controls = last.controls;
  const quotedFree = (last.content ?? '').replace(/“[^”]*”|「[^」]*」|『[^』]*』|"[^"]*"/gu, '');
  const recordOnly = controls.some(c => c.record) || controls.some(c => /(?:不需要|不用|不要)(?:再)?分析/u.test(c.text));
  const stop = controls.some(c => c.stop || c.record);
  const unknown = /^(?:我)?(?:也)?(?:还是)?(?:不知道|说不清|没想好)[。.!！]*$/u.test(quotedFree);
  const expectation = /(?:希望|期待|我想让|我需要).{4,}/u.test(quotedFree) && !/(?:不知道|说不清|没想好)/u.test(quotedFree);
  const specificConcern = /(?:真正|最)(?:让(?:我|自己))?(?:介意|在意)|(?:介意|气|生气)的是|(?:能|可以)理解.{2,}(?:但|可是|不过)|好像只有.{1,}在等/u.test(quotedFree);
  const asked = new Set(context.dialogue.map(d => Object.keys(CONCERN_QUESTIONS).find(k => CONCERN_QUESTIONS[k] === d.question)).filter(Boolean));
  const finish = context.allowNextStep || context.stage === 'review' || context.dialogue.length >= 3 || stop || expectation || (unknown && context.dialogue.length > 0);
  let target = null;
  if (!finish) {
    if (specificConcern && !asked.has('need')) target = 'need';
    else if (context.dialogue.length === 0) target = 'event';
    else if (!asked.has('interpretation') && context.dialogue.length < 2 && !specificConcern) target = 'interpretation';
    else if (!asked.has('need')) target = 'need';
  }
  return { version: CLARITY_TURN_VERSION, finish: finish || target === null, target,
    question: target ? CONCERN_QUESTIONS[target] : null, recordOnly, stopOnly: stop && !last.content,
    sparseUnknown: unknown && context.dialogue.length > 0 && materials.slice(0, -1).reduce((n, m) => n + m.content.length, 0) <= 80,
    materials: materials.filter(m => m.content).map(m => ({ id: m.id, text: m.content })),
    controls: materials.flatMap(m => m.controls.map(c => ({ id: m.id, text: c.text }))) };
}

export function routeClarityCandidate(candidate, context) {
  const plan = clarityTurn(context), value = structuredClone(candidate);
  const opener = /^(?:(?:你在(?:干)?嘛|陪我聊(?:一)?聊|想找人聊(?:一)?聊|聊聊吧|陪我说说话)[，,。！!？?\s]*)+$/u;
  if (context.stage === 'reflect' && context.statements.length === 1 && !context.dialogue.length && opener.test(context.statements[0].text.trim())) {
    return { ok:true,candidate:{ ...value,modeId:'concern',goal:'先说一件想聊的事',title:'慢慢说',reply:'我在，慢慢说就好。',
      question:{text:'你想先从哪件小事说起？',target:'event',evidenceIds:[context.statements[0].id]},claims:[],finish:false } };
  }
  if (((plan.recordOnly && value.modeId === 'moment') || plan.stopOnly || plan.sparseUnknown) && !context.allowNextStep) {
    const selected = plan.sparseUnknown ? plan.materials.slice(0, -1) : plan.stopOnly ? plan.materials : plan.materials.slice(-1);
    const content = selected.map(s => s.text).join('\n');
    // A direct quote is possible only within the unchanged wire capacity.
    // Longer material remains model-generated and must pass the normal checks.
    if (content && content.length <= 240) {
      value.claims = [{ type: 'event', text: content, evidenceIds: selected.map(s => s.id), derivation: 'stated',
        supersedes: context.claims.filter(c => !['edited', 'confirmed'].includes(c.status)).map(c => c.id) }];
      value.question = null; value.finish = true;
    }
  }
  if (value.modeId === 'concern' && !plan.finish && !context.allowNextStep) {
    value.finish = false;
    value.question = { text: plan.question, target: plan.target, evidenceIds: [context.statements.at(-1).id] };
    // With almost no material, do not invent an explanation of the emotion.
    if (context.dialogue.length === 0 && plan.materials.length === 1 && plan.materials[0].text.length < 8) value.reply = '我在听，慢慢说就好。';
  }
  // Do not fabricate a final report when the provider fails to produce one.
  if (plan.finish && (!value.finish || value.question !== null)) return { ok: false, reason: 'turn_not_finished' };
  return { ok: true, candidate: value };
}
