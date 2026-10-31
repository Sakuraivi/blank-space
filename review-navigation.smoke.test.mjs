import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import * as core from './public/core.mjs';
import * as settings from './public/ai-settings.mjs';
import * as keys from './public/personal-key.mjs';
import * as entry from './public/entry-content.mjs';
import * as story from './public/story-method.mjs';
import * as recovery from './public/review-workspace.mjs';

// Executes production functions and delegated handlers, not a browser. This
// intentionally models only rendered form values/actions, not layout or focus.
const decode = value => value.replace(/&(amp|lt|gt|quot|#39);/g, (_, name) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[name]));
const plain = value => JSON.parse(JSON.stringify(value));
function minimalDocument() {
  const listeners = new Map();
  let document;
  class Element {
    constructor(tag = 'div', attributes = {}) {
      this.tagName = tag; this.attributes = attributes; this.id = attributes.id || '';
      this.dataset = Object.fromEntries(Object.entries(attributes).filter(([name]) => name.startsWith('data-')).map(([name, value]) => [name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value]));
      this.value = attributes.value || ''; this.checked = Object.hasOwn(attributes, 'checked');
      this.disabled = Object.hasOwn(attributes, 'disabled'); this.maxLength = Number(attributes.maxlength || 0);
      this.nodes = []; this.isConnected = true; this.open = false; this.textContent = '';
      this.classList = { add() {}, remove() {} };
    }
    set innerHTML(html) {
      this.html = html;
      for (const node of this.nodes) node.isConnected = false;
      this.nodes = [];
      for (const match of html.matchAll(/<([a-z][\w-]*)\b([^>]*)>/gi)) {
        const attributes = Object.fromEntries([...match[2].matchAll(/([\w:-]+)(?:="([^"]*)")?/g)].map(([, name, value]) => [name, decode(value || '')]));
        const node = new Element(match[1], attributes);
        if (node.tagName === 'textarea') node.value = decode(html.slice(match.index + match[0].length, html.indexOf('</textarea>', match.index)));
        this.nodes.push(node);
      }
    }
    get innerHTML() { return this.html || ''; }
    matches(selector) {
      if (selector.startsWith('#')) return this.id === selector.slice(1);
      if (selector.startsWith('[')) return [...selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)].every(([, name, value]) => Object.hasOwn(this.attributes, name) && (value === undefined || this.attributes[name] === value));
      return this.tagName === selector;
    }
    querySelectorAll(selector) { return this.nodes.filter(node => selector.split(',').some(part => node.matches(part))); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector) { return this.matches(selector) ? this : null; }
    focus() { document.activeElement = this; }
    setSelectionRange() {}
    setAttribute(name, value) { this.attributes[name] = value; }
    hasAttribute(name) { return Object.hasOwn(this.attributes, name); }
    replaceChildren() { this.innerHTML = ''; this.textContent = ''; }
    addEventListener() {}
    showModal() { this.open = true; }
    close() { this.open = false; }
  }
  const fixed = ['main', 'modal', 'modal-content', 'notice'].map(id => new Element('div', { id }));
  document = {
    activeElement: fixed[0],
    querySelectorAll(selector) { return [...fixed, ...fixed.flatMap(node => node.nodes)].filter(node => selector.split(',').some(part => node.matches(part))); },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    addEventListener(type, callback) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(callback); },
    async dispatch(type, target) { for (const listener of listeners.get(type) || []) await listener({ target, preventDefault() {} }); },
  };
  return document;
}

function harness() {
  const document = minimalDocument();
  const calls = [];
  let generate = () => Response.json({ status: 'fallback', reason: 'not_configured' }, { status: 503 });
  const context = createContext({
    ...core, ...settings, ...keys, ...entry, ...story, ...recovery,
    providerErrorMessage: settings.aiErrorMessage, document,
    window: { addEventListener() {}, scrollTo() {} },
    crypto: webcrypto, structuredClone, AbortController, URL, Response,
    setTimeout: () => 1, clearTimeout() {},
    localStorage: { getItem: () => null, setItem() {} },
    async fetch(path, options) {
      const call = { path, options, body: options?.body ? JSON.parse(options.body) : null };
      calls.push(call);
      if (path === '/api/ai/generate') return generate(call);
      if (path === '/api/ai/status') return Response.json({});
      throw new Error('unexpected_fetch');
    },
  });
  const source = readFileSync(new URL('./public/app.mjs', import.meta.url), 'utf8')
    .replace(/^import .+;\r?\n/gm, '')
    .replace(/\r?\nrender\(\);\r?\nconst launchState=state;[\s\S]*$/, '');
  runInContext(source + `\n;globalThis.app = {
    install(session, screen, options, reached) {
      state={screen,modeId:session.modeId,session,question:0,ai:aiState(options)};
      reachedStep=reached;reviewWorkspace=null;reviewingEarlier=false;render();
      if(hasAI()&&state.ai.candidate)state.ai.candidateSourceKey=currentReviewKey();
    },
    state:()=>state, workspace:()=>reviewWorkspace, reached:()=>reachedStep,
    stale:()=>isReviewStale(reviewWorkspace,currentReviewKey()), revisitStep
  };`, context, { filename: 'public/app.mjs (VM smoke)' });
  return {
    app: context.app, document, calls,
    modelCalls: () => calls.filter(call => call.path === '/api/ai/generate'),
    setGenerate(callback) { generate = callback; },
    field(selector) { const node = document.querySelector(selector); assert.ok(node, `rendered input missing: ${selector}`); return node; },
    async click(action, data = {}) {
      const button = document.querySelectorAll('[data-action]').find(node => node.dataset.action === action && Object.entries(data).every(([key, value]) => node.dataset[key] === String(value)));
      assert.ok(button, `rendered action missing: ${action}`);
      assert.equal(button.disabled, false);
      await document.dispatch('click', button);
    },
    async submit() { const form = document.querySelector('#step-form'); assert.ok(form); await document.dispatch('submit', form); },
    async flush() { for (let index = 0; index < 3; index++) await new Promise(resolve => setImmediate(resolve)); },
  };
}

const session = ({ draft = false } = {}) => {
  const value = core.createSession('moment');
  value.story = '和朋友沿河散步，觉得很放松。'; value.focus = '喜欢慢慢走。';
  if (draft) value.review = { title: '原来的标题', sections: [
    { id: 'story', label: '这件小事', text: '原来的第一段', source: '我的原话' },
    { id: 'focus', label: '在意的细节', text: '原来的第二段', source: '我的原话' },
  ] };
  return value;
};
const ai = extra => ({ sourceMode: 'default', providerId: 'deepseek', modelId: 'deepseek-flash',
  route: { sourceMode: 'default', providerId: 'deepseek', modelId: 'deepseek-flash', defaultRevision: 1 },
  configVersion: 'multi-flex-v1', consentVersion: 'multi-provider-v1', setupLocked: true, ...extra });
const candidate = { reflection: { text: '你说和朋友散步很放松。', evidenceIds: ['u_story'] }, hypothesis: null, question: null, nextStep: null };
const reply = call => Response.json({ status: 'candidate', requestId: call.body.requestId, revision: call.body.revision,
  route: { sourceMode: call.body.sourceMode, providerId: call.body.providerId, modelId: call.body.modelId, defaultRevision: call.body.defaultRevision }, candidate });

test('real review events capture edits, recover all removed sections and allow confirmation without losing the title', async () => {
  const h = harness(), value = session({ draft: true });
  h.app.install(value, 'review', undefined, 4);
  h.field('#review-title').value = '自己修改的标题';
  h.field('[data-review-index="0"]').value = '自己修改的第一段';
  await h.click('remove-section', { index: 0 });
  await h.click('remove-section', { index: 0 });
  assert.equal(value.review.sections.length, 0);
  assert.equal(h.app.workspace().removed.length, 2);
  await h.submit();
  assert.equal(h.app.state().screen, 'review');
  assert.equal(value.confirmed, false);
  await h.click('undo-review-removal');
  assert.equal(value.review.sections[0].text, '原来的第二段');
  await h.click('restore-review-sections');
  assert.deepEqual(plain(value.review.sections.map(section => section.text)), ['自己修改的第一段', '原来的第二段']);
  assert.equal(value.review.title, '自己修改的标题');
  await h.submit();
  assert.equal(h.app.state().screen, 'done');
  assert.ok(core.confirmedRecord(value));
  assert.equal(h.calls.length, 0);
});

test('visited navigation retains its forward reach, rejects future jumps and performs no fetch', async () => {
  const h = harness(), value = session();
  h.app.install(value, 'story', undefined, 0);
  h.app.revisitStep('review');
  assert.equal(h.app.state().screen, 'story');
  assert.equal(h.document.querySelector('[data-step="review"]'), null);
  await h.submit();
  await h.submit();
  assert.equal(h.app.state().screen, 'card');
  assert.equal(h.app.reached(), 2);
  await h.click('revisit-step', { step: 'story' });
  await h.click('revisit-step', { step: 'card' });
  assert.equal(h.app.state().screen, 'card');
  h.app.revisitStep('reflect');
  assert.equal(h.app.state().screen, 'card');
  assert.equal(h.calls.length, 0);
});

test('an AI question before the first draft survives revisiting without committing or losing the pending answer', async () => {
  const h = harness(), value = session();
  const question = { ...candidate, question: { text: '慢慢走时，你在意什么？', evidenceIds: ['u_story'] } };
  h.app.install(value, 'reflect', ai({ status: 'ready', candidate: question, answer: '还没有发送的回答' }), 3);
  await h.click('revisit-step', { step: 'story' });
  await h.click('revisit-step', { step: 'card' });
  await h.click('skip-card');
  assert.equal(h.app.state().screen, 'reflect');
  assert.equal(h.app.state().ai.candidate, question);
  assert.equal(h.field('#entry').value, '还没有发送的回答');
  assert.equal(value.turns.length, 0);
  assert.equal(h.calls.length, 0);
  h.field('#entry').value = '我在意不用赶时间。';
  await h.submit(); await h.flush();
  assert.equal(value.turns.length, 1);
  assert.equal(value.turns[0].answer, '我在意不用赶时间。');
  assert.equal(h.modelCalls().length, 1);
  assert.equal(h.modelCalls()[0].body.session.turns[0].answer, '我在意不用赶时间。');
});

test('AI answers remain editable in history after switching to a raw-text draft', async () => {
  const h = harness(), value = session();
  value.turns.push({ id: 't1', question: '什么让你觉得放松？', answer: '身边有朋友。' });
  h.app.install(value, 'reflect', ai({ status: 'error' }), 3);
  await h.click('ai-local-review');
  assert.equal(h.app.state().ai.enabled, false);
  await h.click('revisit-step', { step: 'reflect' });
  assert.equal(h.field('[data-turn-index="0"]').value, '身边有朋友。');
  h.field('[data-turn-index="0"]').value = '朋友在身边，不用一直说话。';
  await h.click('return-review');
  assert.equal(value.turns[0].answer, '朋友在身边，不用一直说话。');
  assert.equal(h.app.stale(), true);
  assert.equal(h.calls.length, 0);
});

test('editing earlier content marks an existing draft stale while preserving edited and removed sections without sending', async () => {
  const h = harness(), value = session({ draft: true });
  h.app.install(value, 'review', ai(), 4);
  h.field('#review-title').value = '保留我的标题';
  h.field('[data-review-index="0"]').value = '保留我的编辑';
  await h.click('remove-section', { index: 0 });
  const oldDraft = value.review;
  const removed = plain(h.app.workspace().removed);
  await h.click('revisit-step', { step: 'story' });
  h.field('#entry').value = '修改后的散步经历，依旧很放松。';
  await h.click('return-review');
  assert.equal(value.review, oldDraft);
  assert.equal(value.review.title, '保留我的标题');
  assert.deepEqual(plain(h.app.workspace().removed), removed);
  assert.equal(h.app.stale(), true);
  assert.equal(h.calls.length, 0);
});

test('explicit AI regeneration preserves the old draft on cancel, failure and late reply; only current success replaces it', async () => {
  const h = harness(), value = session({ draft: true });
  h.app.install(value, 'review', ai(), 4);
  await h.click('remove-section', { index: 0 });
  await h.click('revisit-step', { step: 'story' });
  h.field('#entry').value = '修改后想重新整理的散步经历。';
  await h.click('return-review');
  const oldDraft = value.review;
  const removed = plain(h.app.workspace().removed);
  await h.click('regenerate-review');
  await h.click('close-modal');
  assert.equal(h.calls.length, 0);
  assert.equal(value.review, oldDraft);
  await h.click('regenerate-review');
  await h.click('confirm-action'); await h.flush();
  assert.equal(h.modelCalls().length, 1);
  assert.equal(value.review, oldDraft);
  assert.deepEqual(plain(h.app.workspace().removed), removed);
  await h.click('return-review');
  let resolveLate;
  h.setGenerate(call => new Promise(resolve => { resolveLate = () => resolve(reply(call)); }));
  await h.click('regenerate-review'); await h.click('confirm-action');
  assert.equal(h.app.state().ai.status, 'loading');
  await h.click('return-review');
  assert.equal(h.modelCalls().at(-1).options.signal.aborted, true);
  resolveLate(); await h.flush();
  assert.equal(value.review, oldDraft);
  assert.deepEqual(plain(h.app.workspace().removed), removed);
  h.setGenerate(reply);
  await h.click('regenerate-review'); await h.click('confirm-action'); await h.flush();
  assert.equal(h.modelCalls().length, 3);
  assert.notEqual(value.review, oldDraft);
  assert.equal(value.review.sections[0].text, candidate.reflection.text);
  assert.equal(h.app.workspace().removed.length, 0);
  assert.equal(h.app.state().screen, 'review');
});
