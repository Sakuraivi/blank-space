import { findAiProfile } from './ai-settings.mjs';

// Page-lifetime choice and credential. Never put the credential in a DOM value,
// storage, URL, record or serialized settings object.
export function createPersonalKeyPreference() {
  let choice = { sourceMode: 'default' };
  let key = '';
  return Object.freeze({
    apply(draft, providers) {
      if (draft?.sourceMode === 'default') {
        choice = { sourceMode: 'default' }; key = '';
        return { ok: true };
      }
      if (draft?.sourceMode !== 'personal') return { ok: false, reason: 'invalid_source' };
      if (!findAiProfile(providers, draft.providerId, draft.modelId, { allowCustom: true })) return { ok: false, reason: 'unsupported_model' };
      if (typeof draft.apiKey !== 'string') return { ok: false, reason: 'invalid_personal_key' };
      let nextKey = draft.apiKey.trim();
      if (!nextKey && draft.retainExisting === true && choice.sourceMode === 'personal' && choice.providerId === draft.providerId && choice.modelId === draft.modelId) nextKey = key;
      if (!nextKey) return { ok: false, reason: 'missing_personal_key' };
      if (!/^[\x21-\x7e]{16,256}$/.test(nextKey)) return { ok: false, reason: 'invalid_personal_key' };
      // Commit all fields only after validation; failed drafts leave no changes.
      choice = { sourceMode: 'personal', providerId: draft.providerId, modelId: draft.modelId };
      key = nextKey;
      return { ok: true };
    },
    clear() { choice = { sourceMode: 'default' }; key = ''; },
    hasKey() { return choice.sourceMode === 'personal' && key.length > 0; },
    selection() { return { ...choice }; },
    forRequest() { return { ...choice, personalApiKey: choice.sourceMode === 'personal' ? key : '' }; },
  });
}
