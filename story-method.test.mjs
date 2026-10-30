import test from 'node:test';
import assert from 'node:assert/strict';
import { canChooseStoryMethod, createStoryMethodGate } from './public/story-method.mjs';

const storyState = changes => ({
  screen: 'story', session: { id: 'story-session-1', modeId: 'moment', story: '周末散步很自在。' },
  ai: { enabled: false, setupLocked: false, revision: 0 }, ...changes,
});
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

test('method choice belongs only to the explicit first-story setup window', () => {
  const state = storyState();
  assert.equal(canChooseStoryMethod(state), true);
  state.ai.enabled = true;
  assert.equal(canChooseStoryMethod(state), true); // Switching back to local remains possible.
  for (const screen of ['home', 'focus', 'card', 'reflect', 'review', 'done']) {
    assert.equal(canChooseStoryMethod(storyState({ screen })), false);
  }
  for (const malformed of [null, {}, storyState({ session: null }), storyState({ ai: {} }), storyState({ session: { id: '', modeId: 'moment' } })]) {
    assert.equal(canChooseStoryMethod(malformed), false);
  }
});

test('a pending status read cannot attach to a different record or theme', () => {
  const gate = createStoryMethodGate();
  const state = storyState();
  const ticket = gate.begin(state);
  assert.equal(gate.isCurrent(ticket, state), true);
  assert.equal(gate.isCurrent(ticket, storyState({ session: { ...state.session, id: 'another-session' } })), false);
  assert.equal(gate.isCurrent(ticket, storyState({ session: { ...state.session, modeId: 'choice' } })), false);
  assert.equal(gate.isCurrent(ticket, storyState({ screen: 'focus' })), false);
});

test('two asynchronous choices in the same story accept only the latest intent', async () => {
  const gate = createStoryMethodGate();
  const state = storyState();
  const firstStatus = deferred(), secondStatus = deferred();
  const opened = [];
  const openAfterStatus = async status => {
    const ticket = gate.begin(state);
    await status.promise;
    if (gate.isCurrent(ticket, state)) opened.push(ticket);
  };
  const first = openAfterStatus(firstStatus);
  const second = openAfterStatus(secondStatus);
  firstStatus.resolve(); await first;
  assert.equal(opened.length, 0);
  secondStatus.resolve(); await second;
  assert.equal(opened.length, 1);
});

test('choosing local or closing a pending dialog cancels a late status result without changing the story', async () => {
  const gate = createStoryMethodGate();
  const state = storyState();
  const originalStory = state.session.story;
  const status = deferred();
  const ticket = gate.begin(state);
  const pending = status.promise.then(() => gate.isCurrent(ticket, state));
  gate.invalidate(); // Local was already selected while the AI status read ran.
  status.resolve();
  assert.equal(await pending, false);
  assert.equal(state.session.story, originalStory);
  assert.equal(state.ai.enabled, false);
});

test('first valid story submission keeps method selection locked after navigating back', () => {
  const gate = createStoryMethodGate();
  const state = storyState();
  const ticket = gate.begin(state);
  state.ai.setupLocked = true;
  state.screen = 'focus';
  assert.equal(gate.isCurrent(ticket, state), false);
  state.screen = 'story';
  assert.equal(canChooseStoryMethod(state), false);
  assert.equal(gate.begin(state), null);
  assert.equal(gate.isCurrent(ticket, state), false);
});

test('typing does not cancel the choice and tickets contain only non-secret lifecycle metadata', () => {
  const gate = createStoryMethodGate();
  const state = storyState();
  state.session.story = 'PRIVATE_STORY_NOT_FOR_TICKET';
  state.ai.personalApiKey = 'PRIVATE_KEY_NOT_FOR_TICKET';
  const ticket = gate.begin(state);
  state.session.story += '，继续补写。';
  state.ai.revision++;
  assert.equal(gate.isCurrent(ticket, state), true);
  assert.deepEqual(Object.keys(ticket).sort(), ['generation', 'modeId', 'sessionId']);
  assert.doesNotMatch(JSON.stringify(ticket), /PRIVATE_|继续补写|personalApiKey/);
});

test('applying settings can resume with a newly issued consent ticket in the same record', () => {
  const gate = createStoryMethodGate();
  const state = storyState();
  const before = { id: state.session.id, story: state.session.story };
  const settings = gate.begin(state);
  assert.equal(gate.isCurrent(settings, state), true);
  gate.invalidate(); // Closing settings must finish its intent first.
  const consent = gate.begin(state);
  assert.equal(gate.isCurrent(settings, state), false);
  assert.equal(gate.isCurrent(consent, state), true);
  assert.ok(Object.isFrozen(consent));
  assert.deepEqual({ id: state.session.id, story: state.session.story }, before);
});

test('copied, fabricated or other-gate tickets cannot authorize an old dialog submission', () => {
  const state = storyState();
  const gate = createStoryMethodGate();
  const ticket = gate.begin(state);
  assert.equal(gate.isCurrent({ ...ticket }, state), false);
  assert.equal(gate.isCurrent(JSON.parse(JSON.stringify(ticket)), state), false);
  assert.equal(createStoryMethodGate().isCurrent(ticket, state), false);
  gate.invalidate();
  assert.equal(gate.isCurrent(ticket, state), false);
  assert.equal(gate.isCurrent(null, state), false);
});
