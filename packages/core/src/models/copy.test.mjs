/* eslint-disable */
// Run: node --test vite/design-toolbar/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCopyModel } from './copy.mjs';

test('begin trims and exposes the original text', () => {
  const s = createCopyModel().begin('  Save changes  ');
  assert.equal(s.before, 'Save changes');
});

test('toEdit emits the 0003 copy record for a wording change', () => {
  const s = createCopyModel().begin('Save');
  assert.deepEqual(s.toEdit('Apply'), { type: 'copy', before: 'Save', after: 'Apply' });
});

test('toEdit returns null when the wording is unchanged', () => {
  const s = createCopyModel().begin('Save');
  assert.equal(s.toEdit('Save'), null);
});

test('toEdit ignores surrounding-whitespace-only differences', () => {
  const s = createCopyModel().begin('Save');
  assert.equal(s.toEdit('  Save  '), null);
});

test('toEdit trims the stored before/after', () => {
  const s = createCopyModel().begin('  Sign in  ');
  assert.deepEqual(s.toEdit('  Log in  '), { type: 'copy', before: 'Sign in', after: 'Log in' });
});

test('empty/nullish text is handled without throwing', () => {
  const s = createCopyModel().begin(null);
  assert.equal(s.before, '');
  assert.equal(s.toEdit(''), null);
  assert.deepEqual(s.toEdit('Hello'), { type: 'copy', before: '', after: 'Hello' });
});
