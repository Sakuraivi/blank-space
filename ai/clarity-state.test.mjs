import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as state from '../public/clarity-state.mjs';
import { validateClarityCandidate } from '../public/clarity-contract.mjs';
import { createSession, makeReview, confirmedRecord } from '../public/core.mjs';
import { inputs, c01Candidate } from './fixtures/clarity-c01.mjs';
const store = initial => { let value = initial ?? null; return { getItem: () => value, setItem: (_, next) => { value = next; } }; };
function reply(s, candidate) {
  const ticket = state.beginClarityRequest(s);
  const result = state.applyClarityReply(s, ticket, { flow: 'clarity-v2', requestId: ticket.requestId, revision: ticket.revision, status: 'candidate', candidate: candidate ?? c01Candidate(ticket.context) });
  assert.equal(result.ok, true, JSON.stringify(result)); return ticket;
}
function complete() { const s = state.createClaritySession(); for (const input of inputs) { state.addExpression(s, input); reply(s); } return s; }

test('C01: four sends produce three linked blocks; the fifth primary action saves without a call', () => {
  const s = complete();
  assert.equal(s.callCount, 4); assert.equal(s.dialogue.length, 3); assert.equal(s.stage, 'reviewing');
  assert.deepEqual(s.review.blocks.map(b => b.label), ['让你卡住的', '这次分清了', '还留着的问号']);
  assert.match(s.review.blocks[1].text, /主动重约/); assert.match(s.review.blocks[2].text, /仍不知道/);
  const storage = store(), saved = state.saveClarityRecord(s, storage);
  assert.equal(saved.ok, true); assert.equal(s.stage, 'kept'); assert.equal(s.callCount, 4);
  const persisted = JSON.parse(storage.getItem())[0];
  assert.equal(persisted.formatVersion, 2); assert.equal(persisted.statements, undefined); assert.equal(persisted.claims, undefined);
  assert.equal(persisted.review.blocks[0].claimIds, undefined); assert.equal(persisted.review.blocks[0].edited, undefined);
});
test('a late response after a correction cannot overwrite new wording', () => {
  const s = state.createClaritySession(); state.addExpression(s, inputs[0]); const ticket = state.beginClarityRequest(s);
  state.reviseExpression(s, 'u1', '我是生气，不是失落。');
  assert.equal(state.applyClarityReply(s, ticket, { flow: 'clarity-v2', requestId: ticket.requestId, revision: ticket.revision, status: 'candidate', candidate: c01Candidate(ticket.context) }).reason, 'inactive');
  assert.equal(s.statements[0].text, '我是生气，不是失落。'); assert.equal(s.claims.length, 0);
});
test('manual edits keep authoritative wording and sources; new model text cannot replace them', () => {
  const s = complete(); state.editClarityBlock(s, 'insight', '其实我只想知道，这个周末还要不要空着。');
  assert.equal(state.wireSession(s).claims.find(c => c.status === 'edited').text, s.review.blocks[1].text);
  const edited = s.claims.find(c => c.status === 'edited');
  assert.match(s.statements.find(u => u.id === edited.evidenceIds[0]).text, /这个周末/);
  const ticket = state.beginClarityRequest(s), c = c01Candidate(ticket.context); c.claims[1].supersedes.push(edited.id);
  state.applyClarityReply(s, ticket, { flow: 'clarity-v2', requestId: ticket.requestId, revision: ticket.revision, status: 'candidate', candidate: c });
  assert.match(s.review.blocks[1].text, /这个周末/); assert.equal(s.stale, true);
  assert.equal(state.saveClarityRecord(s, store()).reason, 'review_stale');
  state.acknowledgeClarityReview(s); assert.equal(state.saveClarityRecord(s, store()).ok, true);
});
test('edited upstream material invalidates a review and only visible claims can be confirmed', () => {
  const s = complete(); state.reviseExpression(s, 'u4', '现在我不想再约，只想安排自己的周末。');
  assert.equal(state.saveClarityRecord(s, store()).reason, 'review_stale');
  s.claims.push({ id: 'hidden', type: 'insight', text: '未显示的理解', status: 'stale', archived: false });
  state.acknowledgeClarityReview(s); assert.equal(s.claims.at(-1).archived, true);
  assert.equal(state.saveClarityRecord(s, store()).ok, true); assert.notEqual(s.claims.at(-1).status, 'confirmed');
});
test('remove every block, restore, and regenerate without resurrecting user removals', () => {
  const s = complete(); s.review.blocks.map(b => b.id).forEach(id => state.removeClarityBlock(s, id));
  assert.equal(state.saveClarityRecord(s, store()).reason, 'empty_review');
  state.restoreClarityBlock(s); assert.equal(s.review.blocks.length, 1);
  reply(s); assert.deepEqual(s.review.blocks.map(b => b.id), ['unknown']);
  state.restoreClarityBlock(s); state.restoreClarityBlock(s);
  assert.equal(s.review.blocks.length, 3); assert.equal(state.saveClarityRecord(s, store()).ok, true);
});
test('failed storage never reports saved; corrupt records are not overwritten', () => {
  const s = complete(); assert.equal(state.saveClarityRecord(s, { getItem: () => null, setItem: () => { throw Error('quota'); } }).reason, 'storage_failed');
  assert.equal(s.stage, 'reviewing'); assert.equal(s.dirty, true);
  const corrupt = store('{broken'); assert.equal(state.saveClarityRecord(s, corrupt).reason, 'storage_failed'); assert.equal(corrupt.getItem(), '{broken');
});
test('V1 is readable and retained verbatim; exporting excludes details and transient data by default', () => {
  const old = createSession('moment'); old.story = '周末散步。'; old.review = makeReview(old); old.confirmed = true;
  const raw = confirmedRecord(old); assert.ok(raw);
  const storage = store(JSON.stringify([raw])); const s = complete(); state.addClarityNote(s, '仅在详情中保留。');
  const { record } = state.saveClarityRecord(s, storage);
  assert.deepEqual(JSON.parse(storage.getItem())[1], raw); assert.ok(state.readClarityRecord(raw));
  assert.doesNotMatch(state.recordText(record), /仅在详情/); assert.match(state.recordText(record, { details: true }), /仅在详情/);
  const long = structuredClone(record); long.review.blocks[0].text = '长'.repeat(20000); assert.ok(state.readClarityRecord(long));
});
test('new text after preview requires reconsideration; local review never invents later answers', () => {
  const s = state.createClaritySession(); state.addExpression(s, '只想把今天这一句话留住。'); state.openClarityReview(s);
  assert.equal(s.review.blocks[0].text, '只想把今天这一句话留住。'); assert.equal(s.callCount, 0);
  state.addExpression(s, '还有些不同的想法。'); assert.equal(s.stale, true);
});
test('a follow-up question cannot silently validate an old preview after new material', () => {
  const s = state.createClaritySession(); state.addExpression(s, inputs[0]); reply(s); state.openClarityReview(s);
  state.addExpression(s, inputs[1]); reply(s);
  assert.equal(s.stage, 'exploring'); assert.equal(s.stale, true);
  state.openClarityReview(s); assert.equal(state.saveClarityRecord(s, store()).reason, 'review_stale');
});
test('later feelings and thoughts cannot evict the concrete event from the report', () => {
  const s = complete();
  s.claims.push({ id: 'new_feeling', type: 'feeling', text: '不是失落，是生气。', status: 'candidate', evidenceIds: ['u3'] },
    { id: 'new_thought', type: 'thought', text: '又怕开口显得在逼对方。', status: 'candidate', evidenceIds: ['u3'] });
  const review = state.composeClarityReview(s);
  assert.match(review.blocks[0].text, /留出了周六/); assert.match(review.blocks[0].text, /是生气/); assert.match(review.blocks[0].text, /在逼对方/);
  assert.equal(review.blocks.length, 3); assert.equal(review.blocks[0].claimIds.length, 3);
});
test('an explicit expectation in response to a needs question routes the next request to review', () => {
  const s = state.createClaritySession(); state.addExpression(s, inputs[0]); reply(s);
  s.question = { text: '你希望怎样安排？', target: 'need', evidenceIds: ['u1'] };
  state.addExpression(s, inputs[3]); const ticket = state.beginClarityRequest(s);
  assert.equal(ticket.context.stage, 'review'); assert.equal(ticket.context.allowNextStep, false);
  const repeat = c01Candidate({ ...ticket.context, stage: 'reflect' });
  assert.equal(validateClarityCandidate(repeat, ticket.context).reason, 'question_not_allowed');
});
test('recorded real C01 responses retain time investment, corrected emotion and expectation after merge', () => {
  const report = JSON.parse(readFileSync(new URL('./evaluations/2026-10-31-c01.json', import.meta.url), 'utf8'));
  const s = state.createClaritySession();
  for (const call of report.calls.slice(0, 4)) {
    const context = JSON.parse(call.input.messages[1].content);
    state.addExpression(s, context.statements.at(-1).text); reply(s, JSON.parse(call.output.choices[0].message.content));
  }
  assert.equal(s.stage, 'reviewing'); assert.match(s.review.blocks[0].text, /两个周六/);
  assert.match(s.review.blocks[0].text, /生气/); assert.match(s.review.blocks[0].text, /逼/);
  assert.match(s.review.blocks[1].text, /新时间/); assert.match(s.review.blocks[2].text, /是否/);
  assert.equal(s.review.blocks.length, 3); assert.equal(state.saveClarityRecord(s, store()).ok, true);
});
test('one active request, explicit retry limit, and unrequested action rejection', () => {
  const s = state.createClaritySession(); state.addExpression(s, inputs[0]);
  let t = state.beginClarityRequest(s); assert.throws(() => state.beginClarityRequest(s), /request_in_progress/);
  const bad = c01Candidate(t.context); bad.claims[0].type = 'action'; assert.equal(validateClarityCandidate(bad, t.context).reason, 'action_not_allowed');
  state.failClarityRequest(s, t, 'network_error'); assert.equal(s.callCount, 1);
  for (let i = 1; i < 5; i++) { t = state.beginClarityRequest(s); state.failClarityRequest(s, t, 'network_error'); }
  assert.throws(() => state.beginClarityRequest(s), /session_limit/); state.openClarityReview(s); assert.equal(state.saveClarityRecord(s, store()).ok, true);
});
