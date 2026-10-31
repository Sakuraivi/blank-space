import { buildClarityContext, validateClarityCandidate } from './clarity-contract.mjs';
import { validateSavedRecord } from './core.mjs';
export const RECORD_STORE = 'liubai.records.v1';
const copy = x => structuredClone(x);
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const text = (x, max) => typeof x === 'string' && x.trim() && x.length <= max;
const uid = () => crypto.randomUUID();

export function createClaritySession() {
  return { id: uid(), createdAt: new Date().toISOString(), modeId: 'auto', goal: null, revision: 0, stage: 'express',
    statements: [], dialogue: [], claims: [], messages: [], question: null, review: null, removed: [],
    pending: null, failure: null, lastRequestAction: false, callCount: 0, dirty: false, stale: false, complete: false, actionProposal: null };
}

export function invalidateClarity(s) {
  s.revision++; s.pending = null; s.failure = null; s.dirty = true;
  if (s.stage === 'kept') s.stage = 'reviewing';
}

export function addExpression(s, value, { kind = 'expression' } = {}) {
  if (!text(value, 4000) || s.statements.length >= 12) throw new TypeError('invalid_expression');
  const question = s.question;
  invalidateClarity(s);
  if (s.review && kind !== 'request') { s.stale = true; s.complete = false; }
  const entry = { id: `u${s.statements.length + 1}`, text: value.trim(), kind };
  s.statements.push(entry);
  if (question && s.dialogue.length < 3 && kind === 'expression') s.dialogue.push({ question: question.text, answerId: entry.id });
  s.lastAnsweredTarget = question?.target ?? null;
  s.messages.push({ role: 'user', statementId: entry.id });
  s.question = null; s.stage = 'exploring';
  return entry;
}

export function reviseExpression(s, statementId, value) {
  const statement = s.statements.find(x => x.id === statementId);
  if (!statement || !text(value, 4000)) throw new TypeError('invalid_expression');
  if (statement.text === value.trim()) return;
  invalidateClarity(s); statement.text = value.trim(); statement.kind = 'correction';
  s.claims.forEach(c => { if (!c.archived) c.status = 'stale'; });
  s.stale = true; s.complete = false; s.question = null; s.actionProposal = null;
  // Keep the user's existing review intact for an explicit edit/review decision.
}

export function wireSession(s) {
  if (s.aiContextInvalid) throw new TypeError('manual_context_too_large');
  return { id: s.id, modeId: s.modeId, goal: s.goal, statements: copy(s.statements), dialogue: copy(s.dialogue),
    claims: s.claims.filter(c => !c.archived).map(({ id, type, text, evidenceIds, derivation, status }) => ({ id, type, text, evidenceIds, derivation, status })) };
}

export function beginClarityRequest(s, { action = false } = {}) {
  if (s.pending) throw new Error('request_in_progress');
  if (s.callCount >= 5) throw new Error('session_limit');
  // A clear answer to the needs question should produce a review, not ask the
  // user to quantify the same expectation again. This is a routing cue only;
  // the resulting review still requires the user's confirmation.
  const latest = s.statements.at(-1)?.text ?? '';
  const explicitExpectation = s.lastAnsweredTarget === 'need' && latest.length >= 10 &&
    /(?:希望|期待|想要|我想让|我需要).{4,}/u.test(latest) && !/(?:不知道|说不清|没想好)/u.test(latest);
  const stage = action || s.dialogue.length >= 3 || explicitExpectation ? 'review' : 'reflect';
  const context = buildClarityContext({ session: wireSession(s), revision: s.revision, stage, allowNextStep: action });
  const ticket = { requestId: uid(), revision: s.revision, sessionId: s.id, context };
  s.pending = ticket; s.failure = null; s.lastRequestAction = action; s.callCount++;
  return copy(ticket);
}

export const isCurrentClarity = (s, ticket) => Boolean(s.pending && s.id === ticket.sessionId && s.revision === ticket.revision && s.pending.requestId === ticket.requestId);

export function applyClarityReply(s, ticket, envelope) {
  if (!isCurrentClarity(s, ticket)) return { ok: false, reason: 'inactive' };
  if (envelope?.flow !== 'clarity-v2' || envelope.requestId !== ticket.requestId || envelope.revision !== ticket.revision) return failClarityRequest(s, ticket, 'invalid_response');
  if (envelope.status !== 'candidate') return failClarityRequest(s, ticket, envelope.reason ?? 'generation_failed');
  const checked = validateClarityCandidate(envelope.candidate, ticket.context);
  if (!checked.ok) return failClarityRequest(s, ticket, checked.reason);
  const candidate = checked.candidate;
  s.pending = null; s.failure = null; s.modeId = candidate.modeId; s.goal = candidate.goal;
  s.messages.push({ role: 'assistant', text: candidate.reply, question: candidate.question?.text ?? null });
  let protectedConflict = false;
  candidate.claims.forEach((item, index) => {
    const old = s.claims.filter(c => item.supersedes.includes(c.id));
    if (old.some(c => c.locked || ['edited', 'confirmed'].includes(c.status))) { protectedConflict = true; return; }
    old.forEach(c => { c.archived = true; });
    const claim = { ...copy(item), id: `c${ticket.revision}_${s.callCount}_${index}`, status: 'candidate', archived: false };
    s.claims.push(claim);
    if (item.type === 'action') s.actionProposal = claim;
  });
  s.question = candidate.question; s.complete = candidate.finish;
  s.stale = protectedConflict || s.claims.some(c => !c.archived && c.status === 'stale') ||
    (s.stale && (!candidate.finish || ticket.context.allowNextStep));
  if (candidate.finish) {
    const fresh = composeClarityReview(s, candidate.title);
    if (s.review) {
      // Stable block IDs preserve manual edits even when the model restates them.
      const excluded = new Set(s.removed.map(x => x.block.id));
      fresh.blocks = fresh.blocks.filter(b => !excluded.has(b.id)).map(b => s.review.blocks.find(old => old.id === b.id && old.edited) ?? b);
      for (const b of s.review.blocks.filter(b => b.edited && !fresh.blocks.some(n => n.id === b.id))) fresh.blocks.push(copy(b));
      let mainCount = 0;
      fresh.blocks = fresh.blocks.map(b => b.group === 'main' && ++mainCount > 3 ? { ...b, group: 'details' } : b);
      fresh.blocks = fresh.blocks.slice(0, 6);
    }
    if (!ticket.context.allowNextStep) s.review = fresh;
    s.stage = 'reviewing';
  } else s.stage = 'exploring';
  return { ok: true };
}

export function failClarityRequest(s, ticket, reason) {
  if (!isCurrentClarity(s, ticket)) return { ok: false, reason: 'inactive' };
  s.pending = null; s.failure = reason; return { ok: false, reason };
}

const groups = {
  concern: [['context', '让你卡住的', ['event', 'thought', 'feeling']], ['insight', '这次分清了', ['insight', 'need', 'tradeoff', 'option']], ['unknown', '还留着的问号', ['unknown']]],
  moment: [['context', '这一刻', ['event']], ['insight', '我想留下的', ['insight', 'feeling', 'need']], ['unknown', '还想慢慢想的', ['unknown']]],
  choice: [['context', '我的标准', ['need', 'event']], ['insight', '关键取舍', ['tradeoff', 'insight', 'option']], ['unknown', '还缺的信息', ['unknown']]],
};
export function composeClarityReview(s, title = '这次的整理') {
  const active = s.claims.filter(c => !c.archived && c.status !== 'stale' && c.type !== 'action');
  const blocks = (groups[s.modeId] ?? groups.concern).flatMap(([id, label, types]) => {
    // An updated feeling must not evict the actual event from the report.
    // Preserve the latest event, feeling and thought as a linked context block.
    const selected = s.modeId === 'concern' && id === 'context'
      ? ['event', 'feeling', 'thought'].map(type => active.findLast(c => c.type === type)).filter(Boolean)
      : [active.findLast(c => types.includes(c.type))].filter(Boolean);
    const distinct = selected.filter((c, index) => !selected.some((other, i) => i !== index && other.text.includes(c.text) && (other.text !== c.text || i < index)));
    return distinct.length ? [{ id, type: 'text', group: 'main', label: !s.complete && id === 'insight' ? '目前的理解' : label, text: distinct.map(c => c.text).join('\n\n'), claimIds: distinct.map(c => c.id), edited: false }] : [];
  });
  if (!blocks.length) blocks.push({ id: 'context', type: 'text', group: 'main', label: '我写下的', text: s.statements.map(x => x.text).join('\n\n'), claimIds: [], edited: false });
  return { title, blocks };
}

export function openClarityReview(s) {
  invalidateClarity(s);
  if (!s.review) s.review = composeClarityReview(s);
  s.stage = 'reviewing';
}
export function editClarityBlock(s, id, value) {
  const block = s.review?.blocks.find(b => b.id === id);
  if (!block || !text(value, 20000)) throw new Error('invalid_review');
  if (block.text === value.trim()) return;
  invalidateClarity(s); block.text = value.trim(); block.edited = true;
  let evidenceId = null;
  if (block.text.length <= 3980 && s.statements.length < 12) {
    evidenceId = `u${s.statements.length + 1}`;
    s.statements.push({ id: evidenceId, text: `我把整理改为：${block.text}`, kind: 'correction' });
    s.messages.push({ role: 'user', statementId: evidenceId });
  } else s.aiContextInvalid = true;
  for (const claim of s.claims.filter(c => block.claimIds?.includes(c.id))) {
    claim.status = 'edited'; claim.locked = true;
    // Manual text remains the authoritative review, even if too long to resend.
    // Never put the old model wording into the next request as a user's edit.
    claim.text = block.text;
    if (evidenceId) { claim.evidenceIds = [evidenceId]; claim.derivation = 'stated'; }
  }
}
export function removeClarityBlock(s, id) {
  const index = s.review?.blocks.findIndex(b => b.id === id) ?? -1;
  if (index < 0) return;
  invalidateClarity(s); s.removed.push({ index, block: s.review.blocks.splice(index, 1)[0] });
}
export function restoreClarityBlock(s) {
  const removed = s.removed.pop(); if (!removed) return;
  if (s.review.blocks.length >= 6) { s.removed.push(removed); return; }
  invalidateClarity(s); s.review.blocks.splice(removed.index, 0, removed.block);
}
export function addClarityNote(s, value = '写下你想留下的话。') {
  if (!s.review || s.review.blocks.length >= 6 || !text(value, 20000)) throw new Error('invalid_review');
  invalidateClarity(s); s.review.blocks.push({ id: `note_${uid()}`, type: 'text', group: 'details', label: '我的补充', text: value, edited: true, claimIds: [] });
}

export function acknowledgeClarityReview(s) {
  // This acknowledges the visible text only, not hidden or now-stale claims.
  s.stale = false;
  const shown = new Set(s.review?.blocks.flatMap(b => b.claimIds ?? []) ?? []);
  s.claims.filter(c => c.status === 'stale').forEach(c => {
    if (shown.has(c.id)) { c.status = 'edited'; c.locked = true; }
    else c.archived = true;
  });
}

function cleanReview(review) {
  if (!plain(review) || !text(review.title, 200) || !Array.isArray(review.blocks) || !review.blocks.length || review.blocks.length > 6) return null;
  const ids = new Set(), blocks = [];
  for (const b of review.blocks) {
    if (!plain(b) || !text(b.id, 100) || !/^[a-zA-Z0-9_-]+$/.test(b.id) || ids.has(b.id) || !['main', 'details'].includes(b.group) || !text(b.label, 200)) return null;
    ids.add(b.id);
    if (b.type === 'text' && text(b.text, 20000)) blocks.push({ id: b.id, type: b.type, group: b.group, label: b.label, text: b.text });
    else if (b.type === 'option-comparison' && Array.isArray(b.rows) && b.rows.length >= 1 && b.rows.length <= 5 && b.rows.every(r => plain(r) && ['option', 'benefit', 'cost', 'unknown'].every(k => text(r[k], 1000)))) {
      blocks.push({ id: b.id, type: b.type, group: b.group, label: b.label, rows: b.rows.map(r => Object.fromEntries(['option', 'benefit', 'cost', 'unknown'].map(k => [k, r[k]]))) });
    } else return null;
  }
  if (blocks.filter(b => b.group === 'main').length > 3) return null;
  return { title: review.title.trim(), blocks };
}

export function readClarityRecord(raw) {
  if (raw?.formatVersion !== 2) {
    if (raw?.formatVersion !== undefined && raw.formatVersion !== 1) return null;
    const old = validateSavedRecord(raw); if (!old || !old.review.sections.length) return null;
    return { formatVersion: 2, id: old.id, modeId: old.modeId, createdAt: old.createdAt, confirmed: true,
      review: { title: old.review.title, blocks: old.review.sections.map((b, i) => ({ id: b.id, type: 'text', group: i < 3 ? 'main' : 'details', label: b.label, text: b.text })) } };
  }
  if (!plain(raw) || raw.confirmed !== true || !text(raw.id, 100) || !/^[a-zA-Z0-9_-]+$/.test(raw.id) || !['moment', 'concern', 'choice'].includes(raw.modeId) ||
      typeof raw.createdAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(raw.createdAt) || !Number.isFinite(Date.parse(raw.createdAt)) || new Date(raw.createdAt).toISOString() !== raw.createdAt) return null;
  const review = cleanReview(raw.review); if (!review) return null;
  return { formatVersion: 2, id: raw.id, modeId: raw.modeId, createdAt: raw.createdAt, confirmed: true, review };
}

export function readRecordEntries(storage) {
  const raw = storage.getItem(RECORD_STORE);
  if (raw === null) return [];
  if (raw.length > 5000000) throw new Error('records_unavailable');
  const items = JSON.parse(raw);
  if (!Array.isArray(items)) throw new Error('records_unavailable');
  return items.map(raw => ({ raw, record: readClarityRecord(raw) }));
}

export function saveClarityRecord(s, storage) {
  if (s.pending) return { ok: false, reason: 'request_in_progress' };
  if (s.stale) return { ok: false, reason: 'review_stale' };
  const record = readClarityRecord({ formatVersion: 2, id: s.id, modeId: s.modeId === 'auto' ? 'concern' : s.modeId, createdAt: s.createdAt, confirmed: true, review: s.review });
  if (!record) return { ok: false, reason: 'empty_review' };
  try {
    // Preserve the exact old payload until that individual record is explicitly edited.
    const entries = readRecordEntries(storage).filter(x => x.raw?.id !== record.id);
    if (entries.length >= 30) return { ok: false, reason: 'records_full' };
    storage.setItem(RECORD_STORE, JSON.stringify([record, ...entries.map(x => x.raw)]));
    s.stage = 'kept'; s.dirty = false;
    const shown = new Set(s.review.blocks.flatMap(b => b.claimIds ?? []));
    s.claims.filter(c => shown.has(c.id)).forEach(c => { c.status = 'confirmed'; c.locked = true; });
    return { ok: true, record };
  } catch { return { ok: false, reason: 'storage_failed' }; }
}

export function recordText(record, { details = false } = {}) {
  const r = readClarityRecord(record); if (!r) throw new Error('invalid_record');
  return `${r.review.title}\n${new Date(r.createdAt).toLocaleDateString('zh-CN')}\n\n` + r.review.blocks.filter(b => details || b.group === 'main').map(b => b.label + '\n' + (b.type === 'text' ? b.text : b.rows.map(row => `${row.option}\n吸引我的：${row.benefit}\n需要付出：${row.cost}\n还不知道：${row.unknown}`).join('\n\n'))).join('\n\n');
}
