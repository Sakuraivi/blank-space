import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from './public/core.mjs';
import { createReviewWorkspace, removeReviewSection, undoReviewRemoval, restoreAllReviewSections, addReviewNote, reviewSourceKey, isReviewStale } from './public/review-workspace.mjs';

const section = id => ({ id, label: `标题 ${id}`, text: `已编辑的正文 ${id}`, source: `来源 ${id}` });
const review = (ids = ['story', 'focus', 'ai_reflection']) => ({ title: '我自己修改的标题', sections: ids.map(section) });
function session() {
  return { ...createSession('moment'), id: 'synthetic-review-session', createdAt: '2026-11-01T00:00:00.000Z', story: '散步时停下看了晚霞。', focus: '有人陪着。',
    cardId: 'pause', cardReflection: '可以慢慢走。', answers: { moment_scene: '河边散步', moment_feeling: '轻松', moment_next: '' },
    turns: [{ id: 't1', question: '当时是什么感受？', answer: '很轻松。' }], feedback: [{ hypothesisText: '你想有人陪伴。', verdict: 'uncertain', correction: '我也喜欢一个人散步。' }],
    review: review() };
}
const options = () => ({ route: { sourceMode: 'default', providerId: 'bailian', modelId: 'qwen3.8-flash', defaultRevision: 4 },
  configVersion: 'multi-flex-v1', consentVersion: 'multi-provider-v1', allowNextStep: false });

test('removing all sections restores original order and complete edited values', () => {
  const draft = review(), before = structuredClone(draft), workspace = createReviewWorkspace(draft, 'source-a');
  assert.equal(workspace.review, draft);
  for (const index of [1, 0, 0]) assert.equal(removeReviewSection(workspace, index), true);
  assert.equal(draft.sections.length, 0); assert.equal(workspace.removed.length, 3);
  assert.equal(restoreAllReviewSections(workspace), true);
  assert.deepEqual(draft, before); assert.equal(workspace.removed.length, 0);
  assert.equal(restoreAllReviewSections(workspace), false);
});

test('single undo is LIFO and preserves the deleted section snapshot', () => {
  const draft = review(), detached = draft.sections[1], original = structuredClone(detached), workspace = createReviewWorkspace(draft, 'source-a');
  assert.equal(removeReviewSection(workspace, 1), true);
  detached.text = '删除后外部旧引用的变化';
  assert.equal(removeReviewSection(workspace, 0), true);
  assert.equal(undoReviewRemoval(workspace), true);
  assert.deepEqual(draft.sections.map(item => item.id), ['story', 'ai_reflection']);
  assert.equal(workspace.removed.length, 1);
  assert.equal(undoReviewRemoval(workspace), true);
  assert.deepEqual(draft.sections[1], original);
  assert.equal(undoReviewRemoval(workspace), false);
});

test('restore all keeps edits to active sections and title instead of resetting the draft', () => {
  const draft = review(), active = draft.sections[0], workspace = createReviewWorkspace(draft, 'source-a');
  removeReviewSection(workspace, 1); removeReviewSection(workspace, 1);
  active.text = '删除别项以后，我又补了一句。'; active.label = '新的标题'; draft.title = '最后想留下的名字';
  assert.equal(restoreAllReviewSections(workspace), true);
  assert.equal(draft.sections[0], active);
  assert.equal(draft.sections[0].text, '删除别项以后，我又补了一句。');
  assert.equal(draft.sections[0].label, '新的标题'); assert.equal(draft.title, '最后想留下的名字');
  assert.deepEqual(draft.sections.map(item => item.id), ['story', 'focus', 'ai_reflection']);
});

test('new notes reserve room for deleted sections, avoid ID collisions and never exceed six', () => {
  const draft = review(['note_1', 'story', 'focus']), workspace = createReviewWorkspace(draft, 'source-a');
  while (draft.sections.length) removeReviewSection(workspace, 0);
  for (let index = 0; index < 3; index++) assert.equal(addReviewNote(workspace), true);
  assert.equal(addReviewNote(workspace), false);
  assert.equal(new Set([...draft.sections.map(item => item.id), ...workspace.removed.map(item => item.section.id)]).size, 6);
  assert.ok(draft.sections.every(item => /^note_\d+$/.test(item.id) && item.label === '我想留下的话' && item.text === '' && item.source === '你在整理时补写的内容'));
  draft.sections[0].text = '新补写的一句话';
  assert.equal(restoreAllReviewSections(workspace), true);
  assert.equal(draft.sections.length, 6); assert.equal(draft.sections[3].text, '新补写的一句话');
  assert.equal(addReviewNote(workspace), false);
  const full = createReviewWorkspace(review(['a', 'b', 'c', 'd', 'e', 'f']), 'full');
  while (full.review.sections.length) removeReviewSection(full, 0);
  assert.equal(addReviewNote(full), false); assert.equal(restoreAllReviewSections(full), true);
  assert.equal(full.review.sections.length, 6);
});

test('empty, malformed and out-of-bounds indices do not mutate or throw', () => {
  const workspace = createReviewWorkspace(review(), 'source-a'), before = structuredClone(workspace);
  for (const index of [undefined, null, '', '0', [], {}, -1, 0.5, NaN, Infinity, 3, 999]) {
    assert.doesNotThrow(() => assert.equal(removeReviewSection(workspace, index), false));
    assert.deepEqual(workspace, before);
  }
  assert.equal(undoReviewRemoval(workspace), false);
  assert.equal(removeReviewSection(null, 0), false); assert.equal(undoReviewRemoval(null), false);
  assert.equal(restoreAllReviewSections(null), false); assert.equal(addReviewNote(null), false);
});

test('source key changes only for actual request input, routing or permission changes', () => {
  const original = session(), settings = options(), key = reviewSourceKey(original, settings);
  const workspace = createReviewWorkspace(original.review, key);
  const mutations = [
    value => { value.story += '后来下雨了。'; }, value => { value.focus = '另一个焦点'; },
    value => { value.cardId = 'glow'; }, value => { value.cardReflection = '新的联想'; },
    value => { value.answers.moment_scene = '新的回答'; }, value => { value.turns[0].answer = '并不轻松。'; },
    value => { value.turns[0].question = '另一题'; }, value => { value.feedback[0].verdict = 'rejected'; },
    value => { value.feedback[0].correction = '补充了不同的意思。'; }, value => { value.modeId = 'choice'; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(original); mutate(changed);
    assert.equal(isReviewStale(workspace, reviewSourceKey(changed, settings)), true);
  }
  for (const mutate of [
    value => { value.route.sourceMode = 'personal'; }, value => { value.route.providerId = 'openai'; },
    value => { value.route.modelId = 'another-model'; }, value => { value.route.defaultRevision++; },
    value => { value.configVersion = 'changed'; }, value => { value.consentVersion = 'changed'; }, value => { value.allowNextStep = true; },
  ]) {
    const changed = structuredClone(settings); mutate(changed);
    assert.equal(isReviewStale(workspace, reviewSourceKey(original, changed)), true);
  }
  assert.equal(isReviewStale(workspace, reviewSourceKey(original, settings)), false);
  assert.equal(isReviewStale(null, key), true);
});

test('source key ignores draft edits, credentials, request IDs and view revisions with deterministic option ordering', () => {
  const value = session(), settings = options(), key = reviewSourceKey(value, settings), secret = 'SYNTHETIC_KEY_MUST_NOT_ENTER_SOURCE_KEY';
  value.review.title = 'DRAFT_TITLE_NOT_AN_INPUT'; value.review.sections[0].text = 'DRAFT_TEXT_NOT_AN_INPUT'; value.confirmed = true;
  value.personalApiKey = secret; value.requestId = 'ignored-request'; value.ai = { revision: 999, personalApiKey: secret };
  const reordered = { allowNextStep: false, consentVersion: settings.consentVersion, configVersion: settings.configVersion,
    route: { defaultRevision: 4, modelId: 'qwen3.8-flash', providerId: 'bailian', sourceMode: 'default', personalApiKey: secret, endpoint: secret },
    requestId: 'different-request', revision: 999, apiKey: secret, personalApiKey: secret, ai: { revision: 1000, key: secret } };
  assert.equal(reviewSourceKey(value, reordered), key);
  assert.doesNotMatch(reviewSourceKey(value, reordered), /SYNTHETIC_KEY|DRAFT_TITLE|DRAFT_TEXT|ignored-request|different-request/);
  value.answers = { moment_next: '', moment_feeling: '轻松', moment_scene: '河边散步' };
  assert.equal(reviewSourceKey(value, reordered), key);
});

test('binding a new draft resets its recovery stack without changing the old draft', () => {
  const first = createReviewWorkspace(review(), 'first-source'); removeReviewSection(first, 0);
  const secondReview = review(['replacement']), second = createReviewWorkspace(secondReview, 'second-source');
  assert.equal(second.review, secondReview); assert.deepEqual(second.removed, []);
  assert.equal(first.removed.length, 1); assert.equal(first.review.sections.length, 2);
  assert.equal(undoReviewRemoval(second), false); assert.equal(isReviewStale(second, 'first-source'), true);
});
