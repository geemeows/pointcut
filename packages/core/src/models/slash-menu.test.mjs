/* eslint-disable */
// Run: node --import tsx --test src/models/slash-menu.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  slashContext,
  filterSkills,
  moveSelection,
  clampActive,
  applyPick,
} from './slash-menu.mjs';

describe('slashContext', () => {
  test('caret in a leading slash-token returns the query and start', () => {
    assert.deepEqual(slashContext('/rev', 4), { query: 'rev', start: 0 });
  });

  test('a bare slash is an empty query', () => {
    assert.deepEqual(slashContext('/', 1), { query: '', start: 0 });
  });

  test('a second slash-token after a completed one starts past the first', () => {
    // "/review " then "/dep" — start is the length of the leading run "/review "
    assert.deepEqual(slashContext('/review /dep', 12), { query: 'dep', start: 8 });
  });

  test('caret after non-slash prose returns null', () => {
    assert.equal(slashContext('hello /rev', 10), null);
  });

  test('caret before the slash run is fine; text after the caret is ignored', () => {
    // caret sits right after "/re"; trailing "view" is past the caret
    assert.deepEqual(slashContext('/review', 3), { query: 're', start: 0 });
  });

  test('a slash that does not start with an alnum char is not a token', () => {
    assert.equal(slashContext('/-x', 3), null);
  });
});

describe('filterSkills', () => {
  const skills = [
    { name: 'review' },
    { name: 'preview' },
    { name: 'deploy' },
  ];

  test('substring match, case-insensitive', () => {
    assert.deepEqual(filterSkills(skills, 'VIEW').map((s) => s.name), ['review', 'preview']);
  });

  test('prefix matches rank ahead of mid-string matches', () => {
    // "re" prefixes "review" but only appears mid-string in "preview"
    assert.deepEqual(filterSkills(skills, 're').map((s) => s.name), ['review', 'preview']);
  });

  test('empty query returns all (every name "includes" "")', () => {
    assert.equal(filterSkills(skills, '').length, 3);
  });

  test('no match returns empty', () => {
    assert.deepEqual(filterSkills(skills, 'zzz'), []);
  });
});

describe('moveSelection', () => {
  test('moves down and up within bounds', () => {
    assert.equal(moveSelection(0, 3, 1), 1);
    assert.equal(moveSelection(1, 3, -1), 0);
  });

  test('wraps at both ends', () => {
    assert.equal(moveSelection(2, 3, 1), 0); // down off the bottom
    assert.equal(moveSelection(0, 3, -1), 2); // up off the top
  });

  test('empty list stays at 0', () => {
    assert.equal(moveSelection(0, 0, 1), 0);
  });
});

describe('clampActive', () => {
  test('resets to 0 when the index is past the end of a shrunk list', () => {
    assert.equal(clampActive(4, 2), 0);
  });
  test('leaves an in-range index alone', () => {
    assert.equal(clampActive(1, 3), 1);
  });
});

describe('applyPick', () => {
  test('inserts "/name " replacing the in-progress token, caret after it', () => {
    // composer "/rev", caret at 4, token starts at 0, pick "review"
    assert.deepEqual(applyPick('/rev', 4, 0, 'review'), { value: '/review ', caret: 8 });
  });

  test('preserves text after the caret', () => {
    // "/rev tail" with caret after "/rev"
    assert.deepEqual(applyPick('/rev tail', 4, 0, 'review'), {
      value: '/review  tail',
      caret: 8,
    });
  });

  test('completes a second token after an already-picked one', () => {
    assert.deepEqual(applyPick('/review /dep', 12, 8, 'deploy'), {
      value: '/review /deploy ',
      caret: 16,
    });
  });
});
