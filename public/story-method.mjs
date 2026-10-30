// UI lifecycle only. This gate owns no story, credential, network or storage.
const identity = state => {
  const session = state?.session;
  return session && typeof session.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(session.id) &&
    typeof session.modeId === 'string' && session.modeId.length > 0 && session.modeId.length <= 100;
};

// Once the first valid story submission sets setupLocked, returning to the
// story is an edit of the same experience, not another configuration window.
export function canChooseStoryMethod(state) {
  return Boolean(identity(state) && state.screen === 'story' && state.ai?.setupLocked === false);
}

export function createStoryMethodGate() {
  let generation = 0;
  let active = null;
  const invalidate = () => { generation++; active = null; };
  return Object.freeze({
    begin(state) {
      // A new intent replaces any earlier pending status/settings intent,
      // including when the new context is no longer eligible.
      invalidate();
      if (!canChooseStoryMethod(state)) return null;
      active = Object.freeze({ generation, sessionId: state.session.id, modeId: state.session.modeId });
      return active;
    },
    isCurrent(ticket, state) {
      return Boolean(active && ticket === active && canChooseStoryMethod(state) &&
        active.generation === generation && active.sessionId === state.session.id && active.modeId === state.session.modeId);
    },
    invalidate,
  });
}
