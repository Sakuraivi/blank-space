// Page-lifetime preference. No storage, network, URL, or serialization ownership.
export function createPersonalKeyPreference() {
  let key = '';
  return Object.freeze({
    set(value) {
      if (typeof value !== 'string') return false;
      const next = value.trim();
      if (next && !/^[\x21-\x7e]{16,256}$/.test(next)) return false;
      key = next;
      return true;
    },
    clear() { key = ''; },
    hasKey() { return key.length > 0; },
    forRequest() { return key; },
  });
}
