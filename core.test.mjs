import test from 'node:test';
import assert from 'node:assert/strict';
import { MODES, CARDS, createSession, makeReview, validateSavedRecord } from './public/core.mjs';
test('three modes and six cards have stable usable interfaces', () => {
  assert.deepEqual(MODES.map(m => m.id), ['moment', 'concern', 'choice']);
  assert.deepEqual(CARDS.map(c => c.id), ['pause', 'glow', 'connect', 'distance', 'turn', 'step']);
  for (const mode of MODES) {
    assert.equal(mode.questions.length, 3);
    assert.equal(new Set(mode.questions.map(q => q.id)).size, 3);
    assert.ok(mode.questions.every(q => q.label && q.prompt && q.placeholder));
    const session = createSession(mode.id);
    assert.equal(session.modeId, mode.id);
    assert.equal(session.confirmed, false);
    assert.deepEqual(makeReview(session).sections, []);
  }
  assert.equal(createSession().modeId, 'moment');
  assert.throws(() => createSession('unknown'), RangeError);
});
test('review uses only supplied text and preserves special characters and long text', () => {
  const s = createSession('choice');
  s.story = '  <script>alert("你好")</script> & "\n下一行  ' + '长'.repeat(4000);
  s.focus = '   ';
  s.answers[MODES[2].questions[1].id] = '不确定 <&> " \'\n';
  const result = makeReview(s);
  assert.equal(result.sections.length, 2);
  assert.equal(result.sections[0].text, s.story);
  assert.equal(result.sections[1].text, s.answers[MODES[2].questions[1].id]);
  assert.ok(result.sections.every(item => item.source));
});
test('saved record accepts edited review, strips unknown fields and rejects untrusted or oversized data', () => {
  const s = createSession('moment');
  s.story = '<img src=x onerror=alert(1)> &';
  const record = { ...s, review: makeReview(s), confirmed: true, extra: 'discard' };
  record.review.sections[0].text = '用户编辑：<b>原文</b>';
  record.review.sections[0].extra = 'discard';
  const result = validateSavedRecord(record);
  assert.equal(result.review.sections[0].text, '用户编辑：<b>原文</b>');
  assert.equal(result.extra, undefined);
  assert.equal(result.review.sections[0].extra, undefined);
  for (const invalid of [null, [], {}, { ...record, confirmed: false }, { ...record, id: '../x' }, { ...record, modeId: 'other' }, { ...record, createdAt: 'invalid' }, { ...record, story: 'x'.repeat(20001) }, { ...record, answers: { unexpected: 'x' } }, { ...record, review: { title: 'x', sections: [{ id: 'x', label: 'x', text: {}, source: 'x' }] } }]) assert.equal(validateSavedRecord(invalid), null);
});

test('warns before leaving unfinished new and edited saved sessions', async () => {
  const { shouldWarnBeforeUnload } = await import('./public/core.mjs');
  const session = createSession();
  assert.equal(shouldWarnBeforeUnload(null), false);
  assert.equal(shouldWarnBeforeUnload(session), false);
  session.story = '今天的一件事';
  assert.equal(shouldWarnBeforeUnload(session), true);
  session.confirmed = true;
  assert.equal(shouldWarnBeforeUnload(session), false);
  session.story = '';
  session.review = { title: '编辑中的记录', sections: [] };
  session.confirmed = false;
  assert.equal(shouldWarnBeforeUnload(session), true);
});
