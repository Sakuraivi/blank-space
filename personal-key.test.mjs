import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersonalKeyPreference } from './public/personal-key.mjs';

test('personal key is page-local, can be cleared, and is not serialized', () => {
  const first = createPersonalKeyPreference();
  const otherPage = createPersonalKeyPreference();
  assert.equal(first.set('  synthetic-personal-key-only  '), true);
  assert.equal(first.forRequest(), 'synthetic-personal-key-only');
  assert.equal(otherPage.hasKey(), false);
  assert.doesNotMatch(JSON.stringify(first), /synthetic-personal/);
  first.clear();
  assert.equal(first.forRequest(), '');
});

test('invalid input cannot silently replace a personal key with the default choice', () => {
  const preference = createPersonalKeyPreference();
  preference.set('synthetic-personal-key-only');
  for (const invalid of ['short', 'x'.repeat(257), 'synthetic key with spaces', '\u4e2d'.repeat(20), null]) {
    assert.equal(preference.set(invalid), false);
    assert.equal(preference.forRequest(), 'synthetic-personal-key-only');
  }
  assert.equal(preference.set(''), true);
  assert.equal(preference.hasKey(), false);
});
