/* eslint-disable */
// Run: node --import tsx --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOC_ATTR, encodeLoc, decodeLoc } from './loc.mjs';

test('LOC_ATTR is the neutral attribute name (no luciq coupling)', () => {
  assert.equal(LOC_ATTR, 'data-pointcut-loc');
});

test('encodeLoc builds the exact file:line:col wire string', () => {
  assert.equal(encodeLoc({ file: 'src/App.vue', line: 2, col: 3 }), 'src/App.vue:2:3');
  assert.equal(encodeLoc({ file: 'public/index.html', line: 1, col: 1 }), 'public/index.html:1:1');
});

test('decodeLoc parses a well-formed loc', () => {
  assert.deepEqual(decodeLoc('src/App.vue:2:3'), { file: 'src/App.vue', line: 2, col: 3 });
});

test('round-trips: decodeLoc(encodeLoc(x)) deep-equals x', () => {
  const cases = [
    { file: 'src/App.vue', line: 2, col: 3 },
    { file: 'a/b/c.svelte', line: 100, col: 1 },
    { file: 'index.html', line: 1, col: 12 },
    // path containing a colon (Windows drive letter) — must survive
    { file: 'C:\\proj\\App.vue', line: 5, col: 7 },
    // path with multiple embedded colons
    { file: 'weird:name:here.vue', line: 9, col: 4 },
  ];
  for (const x of cases) {
    assert.deepEqual(decodeLoc(encodeLoc(x)), x, `round-trip failed for ${x.file}`);
  }
});

test('decodeLoc splits from the right so colons in the path are preserved', () => {
  // Only the final two numeric segments are line/col; everything before is file.
  assert.deepEqual(decodeLoc('C:\\x\\App.vue:5:7'), {
    file: 'C:\\x\\App.vue',
    line: 5,
    col: 7,
  });
});

test('decodeLoc returns null for malformed strings', () => {
  assert.equal(decodeLoc(''), null);
  assert.equal(decodeLoc('noColonsHere'), null);
  assert.equal(decodeLoc('onlyone:5'), null); // only one colon → no col
  assert.equal(decodeLoc('file:notanumber:3'), null); // line not numeric
  assert.equal(decodeLoc('file:5:notanumber'), null); // col not numeric
  assert.equal(decodeLoc(':5:7'), null); // empty file
  assert.equal(decodeLoc(null), null);
  assert.equal(decodeLoc(undefined), null);
});
